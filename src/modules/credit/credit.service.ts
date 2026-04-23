import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma';
import { TrustService } from '../trust/trust.service';
import {
  ExternalCreditService,
  CreditEventType,
  CreditEventSeverity,
} from './external-credit.service';
import { CircleStatus, MembershipStatus } from '@prisma/client';

// ── Credit score tiers ──────────────────────────────────────────────────────
// Maps a finalCreditScore to the maximum loan percentage of expected payout.
// Scores below 550 are not eligible.
const CREDIT_TIERS: { minScore: number; allowedPercent: number }[] = [
  { minScore: 750, allowedPercent: 50 },
  { minScore: 700, allowedPercent: 45 },
  { minScore: 650, allowedPercent: 40 },
  { minScore: 600, allowedPercent: 30 },
  { minScore: 550, allowedPercent: 20 },
];

const DEFAULT_TRUST_DISPLAY_SCORE = 575; // neutral ATI (50) mapped to 300-850 range

export interface FinalCreditScoreResult {
  externalScore: number;
  trustDisplayScore: number;
  finalScore: number;
}

export interface LoanEligibilityResult {
  eligible: boolean;
  finalCreditScore: number;
  allowedPercent: number;
  expectedPayoutKobo: bigint;
  maxLoanAmountKobo: bigint;
  ineligibilityReason?: string;
}

@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trustService: TrustService,
    private readonly externalCreditService: ExternalCreditService,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Compute, cache, and return the final composite credit score for a user.
   *
   * finalScore = (externalScore × 0.7) + (trustDisplayScore × 0.3)
   * Clamped to [300, 850].
   * Falls back to trust score only if external bureau is unavailable.
   */
  async getFinalCreditScore(userId: string): Promise<FinalCreditScoreResult> {
    // A) Trust display score — already in 300-850 range (300 + ATI × 5.5)
    const trustStats = await this.trustService.getTrustScore(userId);
    const rawDisplay = (trustStats as any).displayScore ?? DEFAULT_TRUST_DISPLAY_SCORE;
    const trustDisplayScore = Math.min(850, Math.max(300, Math.round(rawDisplay)));

    // B) External bureau score — null means unavailable
    const rawExternal = await this.externalCreditService.getExternalCreditScore(userId);

    let externalScore: number;
    let finalScore: number;

    if (rawExternal !== null) {
      externalScore = rawExternal;
      finalScore = Math.round(externalScore * 0.7 + trustDisplayScore * 0.3);
    } else {
      // Fallback: external API failed — use trust score only
      this.logger.warn(
        `External credit unavailable for userId=${userId} — falling back to trust score`,
      );
      externalScore = trustDisplayScore;
      finalScore = trustDisplayScore;
    }

    finalScore = Math.min(850, Math.max(300, finalScore));

    // Cache in DB (upsert — always reflects latest)
    await this.prisma.creditScore.upsert({
      where: { userId },
      update: { externalScore, trustDisplayScore, finalScore, lastUpdated: new Date() },
      create: { userId, externalScore, trustDisplayScore, finalScore },
    });

    return { externalScore, trustDisplayScore, finalScore };
  }

  /**
   * Determine loan eligibility for a user in a specific circle.
   *
   * Validates:
   * - Circle is ACTIVE and stable
   * - User has an ACTIVE membership
   * - Credit score clears the minimum tier (550)
   */
  async getLoanEligibility(userId: string, circleId: string): Promise<LoanEligibilityResult> {
    // 1. Validate circle
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
    });

    if (!circle) throw new NotFoundException('Circle not found');

    if (circle.status !== CircleStatus.ACTIVE) {
      return this.ineligible(0n, 0, 'Circle is not active');
    }

    // 2. Validate membership
    const membership = await this.prisma.roscaMembership.findUnique({
      where: { circleId_userId: { circleId, userId } },
    });

    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      return this.ineligible(0n, 0, 'You are not an active member of this circle');
    }

    // 3. Compute credit score
    const { finalScore } = await this.getFinalCreditScore(userId);

    // 4. Determine tier
    const tier = CREDIT_TIERS.find((t) => finalScore >= t.minScore);

    if (!tier) {
      return this.ineligible(0n, finalScore, 'Credit score too low (minimum 550 required)');
    }

    // 5. Estimate expected payout: contributionAmount × filledSlots
    const expectedPayoutKobo = circle.contributionAmount * BigInt(circle.filledSlots);
    const maxLoanAmountKobo = (expectedPayoutKobo * BigInt(tier.allowedPercent)) / 100n;

    return {
      eligible: true,
      finalCreditScore: finalScore,
      allowedPercent: tier.allowedPercent,
      expectedPayoutKobo,
      maxLoanAmountKobo,
    };
  }

  // ── External reporting ─────────────────────────────────────────────────────

  async reportMissedContribution(userId: string): Promise<void> {
    await this.report(userId, 'missed_payment', 'medium');
  }

  async reportLoanDefault(userId: string): Promise<void> {
    await this.report(userId, 'loan_default', 'high');
  }

  async reportPositiveContribution(userId: string): Promise<void> {
    await this.report(userId, 'positive_payment', 'low');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async report(
    userId: string,
    type: CreditEventType,
    severity: CreditEventSeverity,
  ): Promise<void> {
    try {
      await this.externalCreditService.reportCreditEvent({
        userId,
        type,
        severity,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Reporting failure must never surface to callers
      this.logger.error(`Credit report failed: type=${type}, userId=${userId}`, err);
    }
  }

  private ineligible(
    expectedPayoutKobo: bigint,
    finalCreditScore: number,
    ineligibilityReason: string,
  ): LoanEligibilityResult {
    return {
      eligible: false,
      finalCreditScore,
      allowedPercent: 0,
      expectedPayoutKobo,
      maxLoanAmountKobo: 0n,
      ineligibilityReason,
    };
  }
}
