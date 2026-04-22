import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserTrustStats } from '@prisma/client';

export type TrustScoreEvent =
  | { type: 'contribution'; onTime: boolean; isPostPayout?: boolean }
  | { type: 'missed_payment'; isPostPayout?: boolean }
  | { type: 'missed_payment_post_payout_default' } // ×2.0 escalated penalty — member defaulted after receiving payout
  | { type: 'peer_rating'; rating: number } // rating: 1–5
  | { type: 'cycle_reset' }; // call at the start of each new cycle

@Injectable()
export class TrustService {
  constructor(private prisma: PrismaService) {}

  // ── ATI Formula (AJOTI TRUST INDEX) ─────────────────────────────────────
  // Range: 0–100 internal, hard-capped at 95.
  // Display score: 300 + (internal × 5.5) → range 300–850.

  private computeATI(stats: UserTrustStats, userCreatedAt: Date): number {
    // A) Recent Behavior (30%) — current cycle on-time rate
    const recentBehavior =
      stats.expectedPaymentsLastCycle > 0
        ? (stats.onTimePaymentsLastCycle / stats.expectedPaymentsLastCycle) * 100
        : 50; // neutral before first cycle completes

    // B) History Behavior (25%) — all-time reliability with weighted penalties
    //    Weighted Penalties = (late × 0.5) + (missed × 1.5) + (defaulted cycles × 3)
    const weightedPenalties =
      stats.totalLatePayments * 0.5 + stats.totalMissedPayments * 1.5 + stats.totalDefaults * 3;
    const historyBehavior =
      stats.totalExpectedPayments > 0
        ? Math.max(
            0,
            ((stats.totalOnTimePayments - weightedPenalties) / stats.totalExpectedPayments) * 100,
          )
        : 50; // neutral before any history exists

    // C) Payout Reliability (20%) — behaviour after receiving payout
    //    Default = 70 if user has never received a payout (per spec)
    const payoutReliability =
      stats.expectedPostPayoutPayments > 0
        ? (stats.postPayoutOnTimePayments / stats.expectedPostPayoutPayments) * 100
        : 70;

    // D) Peer Trust Score (15%) — average group rating (1–5 scale → 0–100)
    //    Default = 50 (neutral) if no peer ratings yet
    const peerScore = stats.totalPeerRatings > 0 ? (stats.averagePeerRating / 5) * 100 : 50;

    // E) History Length (10%) — account age in months × 8.3, capped at 100
    const now = new Date();
    const monthsActive =
      (now.getFullYear() - userCreatedAt.getFullYear()) * 12 +
      (now.getMonth() - userCreatedAt.getMonth());
    const historyLength = Math.min(100, monthsActive * 8.3);

    // Final ATI — hard cap at 95 (users can never reach 100)
    const ati =
      recentBehavior * 0.3 +
      historyBehavior * 0.25 +
      payoutReliability * 0.2 +
      peerScore * 0.15 +
      historyLength * 0.1;

    return Math.min(95, Math.round(ati));
  }

  // ── Update trust score on a payment or rating event ─────────────────────

  async updateTrustScore(
    userId: string,
    event: TrustScoreEvent,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // Ensure the stats record exists; new users start at 50
    const current = await tx.userTrustStats.upsert({
      where: { userId },
      update: {},
      create: { userId, trustScore: 50 },
    });

    const data: Prisma.UserTrustStatsUpdateInput = { lastUpdated: new Date() };

    switch (event.type) {
      case 'contribution':
        data.totalExpectedPayments = { increment: 1 };
        data.expectedPaymentsLastCycle = { increment: 1 };
        if (event.onTime) {
          data.totalOnTimePayments = { increment: 1 };
          data.onTimePaymentsLastCycle = { increment: 1 };
          data.consecutiveLatePayments = 0;
        } else {
          data.totalLatePayments = { increment: 1 };
          data.consecutiveLatePayments = { increment: 1 };
        }
        if (event.isPostPayout) {
          data.expectedPostPayoutPayments = { increment: 1 };
          if (event.onTime) data.postPayoutOnTimePayments = { increment: 1 };
        }
        break;

      case 'missed_payment':
        data.totalExpectedPayments = { increment: 1 };
        data.totalMissedPayments = { increment: 1 };
        data.expectedPaymentsLastCycle = { increment: 1 };
        data.consecutiveLatePayments = { increment: 1 };
        if (event.isPostPayout) data.expectedPostPayoutPayments = { increment: 1 };
        break;

      case 'missed_payment_post_payout_default':
        // Escalated: counts as both a missed payment AND a default (×3 penalty in ATI)
        data.totalExpectedPayments = { increment: 1 };
        data.totalMissedPayments = { increment: 1 };
        data.totalDefaults = { increment: 1 };
        data.expectedPaymentsLastCycle = { increment: 1 };
        data.expectedPostPayoutPayments = { increment: 1 };
        data.consecutiveLatePayments = { increment: 1 };
        break;

      case 'peer_rating': {
        const newTotal = current.totalPeerRatings + 1;
        const newAvg =
          (current.averagePeerRating * current.totalPeerRatings + event.rating) / newTotal;
        data.totalPeerRatings = newTotal;
        data.averagePeerRating = newAvg;
        break;
      }

      case 'cycle_reset':
        data.onTimePaymentsLastCycle = 0;
        data.expectedPaymentsLastCycle = 0;
        break;
    }

    // Apply counter updates and get the fresh stats in one call
    const updatedStats = await tx.userTrustStats.update({
      where: { userId },
      data,
    });

    // Fetch user createdAt for History Length component
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { createdAt: true },
    });

    const newScore = this.computeATI(updatedStats, user.createdAt);

    await tx.userTrustStats.update({
      where: { userId },
      data: { trustScore: newScore },
    });
  }

  // ── Read trust score ─────────────────────────────────────────────────────

  async getTrustScore(userId: string) {
    const stats = await this.prisma.userTrustStats.findUnique({
      where: { userId },
    });

    if (!stats) {
      return {
        userId,
        trustScore: 50,
        displayScore: 50,
      };
    }

    const displayScore = Math.round(stats.trustScore);
    return { ...stats, displayScore };
  }

  // ── Super-admin read helpers ──────────────────────────────────────────────

  async getAllTrustStats(options: {
    page?: number;
    limit?: number;
    minScore?: number;
    maxScore?: number;
  }) {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.UserTrustStatsWhereInput = {
      ...(options.minScore !== undefined && { trustScore: { gte: options.minScore } }),
      ...(options.maxScore !== undefined && {
        trustScore: {
          ...(options.minScore !== undefined ? { gte: options.minScore } : {}),
          lte: options.maxScore,
        },
      }),
    };

    const [stats, total] = await Promise.all([
      this.prisma.userTrustStats.findMany({
        where,
        skip,
        take: limit,
        orderBy: { trustScore: 'desc' },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      }),
      this.prisma.userTrustStats.count({ where }),
    ]);

    return {
      data: stats.map((s) => ({
        ...s,
        displayScore: Math.round(s.trustScore),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getTrustStatsFull(userId: string) {
    const stats = await this.prisma.userTrustStats.findUnique({
      where: { userId },
      include: { user: { select: { firstName: true, lastName: true, email: true, createdAt: true } } },
    });

    if (!stats) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });

    const displayScore = Math.round(stats.trustScore);
    const atiBreakdown = user ? this.computeATIBreakdown(stats, user.createdAt) : null;

    return { ...stats, displayScore, atiBreakdown };
  }

  // ── Super-admin write helper ──────────────────────────────────────────────

  async fireTrustEventAdmin(userId: string, event: TrustScoreEvent): Promise<void> {
    await this.prisma.$transaction(
      (tx) => this.updateTrustScore(userId, event, tx),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── ATI component breakdown (read-only, for observability) ───────────────

  private computeATIBreakdown(stats: UserTrustStats, userCreatedAt: Date) {
    const recentBehavior =
      stats.expectedPaymentsLastCycle > 0
        ? (stats.onTimePaymentsLastCycle / stats.expectedPaymentsLastCycle) * 100
        : 50;

    const weightedPenalties =
      stats.totalLatePayments * 0.5 + stats.totalMissedPayments * 1.5 + stats.totalDefaults * 3;
    const historyBehavior =
      stats.totalExpectedPayments > 0
        ? Math.max(0, ((stats.totalOnTimePayments - weightedPenalties) / stats.totalExpectedPayments) * 100)
        : 50;

    const payoutReliability =
      stats.expectedPostPayoutPayments > 0
        ? (stats.postPayoutOnTimePayments / stats.expectedPostPayoutPayments) * 100
        : 70;

    const peerScore = stats.totalPeerRatings > 0 ? (stats.averagePeerRating / 5) * 100 : 50;

    const now = new Date();
    const monthsActive =
      (now.getFullYear() - userCreatedAt.getFullYear()) * 12 +
      (now.getMonth() - userCreatedAt.getMonth());
    const historyLength = Math.min(100, monthsActive * 8.3);

    return {
      recentBehavior: Math.round(recentBehavior * 10) / 10,
      historyBehavior: Math.round(historyBehavior * 10) / 10,
      payoutReliability: Math.round(payoutReliability * 10) / 10,
      peerScore: Math.round(peerScore * 10) / 10,
      historyLength: Math.round(historyLength * 10) / 10,
      weights: { recentBehavior: 0.3, historyBehavior: 0.25, payoutReliability: 0.2, peerScore: 0.15, historyLength: 0.1 },
    };
  }
}
