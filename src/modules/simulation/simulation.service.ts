// src/modules/simulation/simulation.service.ts
/**
 * SimulationService
 *
 * Runs trust-score simulations using REAL service methods on a REAL database.
 * All records are prefixed with sim_<runId> so they are safe to run against a
 * development/staging database and easy to identify.
 *
 * Cleanup is ALWAYS performed at the end — there is no "keep records" option
 * through the API, ensuring production data is never polluted.
 */
import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

import { PrismaService } from '@/prisma/prisma.service';
import { SimPrismaService } from './sim-prisma.service';
import { LedgerService } from '@/modules/ledger/ledger.service';
import { TrustService, TrustScoreEvent } from '@/modules/trust/trust.service';
import { ContributionService } from '@/modules/contribution/contribution.service';
import { PayoutService } from '@/modules/payout/payout.service';
import { CircleService } from '@/modules/rosca/services/circle.service';
import { MembershipService } from '@/modules/rosca/services/membership.service';
import { PeerReviewService } from '@/modules/peer-review/peer-review.service';
import { LoanService } from '@/modules/loans/loans.service';

import {
  Gender,
  Role,
  EntryType,
  MovementType,
  LedgerSourceType,
  PayoutLogic,
} from '@prisma/client';

import {
  ManualSimConfigDto,
  ExtraTrustEventDto,
  ExtraTrustEventType,
  SimResult,
  SimEventRecord,
  SimMemberResult,
  AutoSimResult,
} from './dto/simulation.dto';

// ── Internal types ────────────────────────────────────────────────────────────

interface SimUser {
  id: string;
  label: string;
  email: string;
  walletId: string;
}

interface ScoreSnapshot {
  raw: number;
  display: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WALLET_FUND_AMOUNT = 5_000_000n; // ₦50,000 in kobo — generous buffer

@Injectable()
export class SimulationService {
  constructor(
    private readonly prisma: SimPrismaService,
    private readonly ledger: LedgerService,
    private readonly trustService: TrustService,
    private readonly contributions: ContributionService,
    private readonly payout: PayoutService,
    private readonly circle: CircleService,
    private readonly membership: MembershipService,
    private readonly peerReview: PeerReviewService,
    private readonly loanService: LoanService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC: Run the automated 3-circle scenario
  // ═══════════════════════════════════════════════════════════════════════════

  async runAutoSimulation(): Promise<AutoSimResult> {
    const runId = `sim_${Date.now()}`;
    const circleIds: string[] = [];

    try {
      // Run sequentially — parallel execution causes deadlocks on the shared
      // PLATFORM_POOL wallet (Serializable transactions) and on userTrustStats
      // writes. Running in parallel also means Promise.all rejects on the first
      // failure and immediately enters the finally block while the other circles
      // are still executing in the background, leading to FK violations during
      // cleanup.
      const circleA = await this.runCircleA(runId, circleIds);
      const circleB = await this.runCircleB(runId, circleIds);
      const circleC = await this.runCircleC(runId, circleIds);

      return { runId, circleA, circleB, circleC };
    } finally {
      await this.cleanupSimRecords(runId, circleIds);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC: Run a manual config-driven simulation
  // ═══════════════════════════════════════════════════════════════════════════

  async runManualSimulation(config: ManualSimConfigDto): Promise<SimResult> {
    const runId = `sim_${Date.now()}`;
    const circleId: string[] = [];

    try {
      return await this.executeManualSim(runId, circleId, config);
    } finally {
      await this.cleanupSimRecords(runId, circleId);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: Circle A — Best case (all on-time, fair peer ratings)
  // ═══════════════════════════════════════════════════════════════════════════

  private async runCircleA(runId: string, circleIds: string[]): Promise<SimResult> {
    const tracker = new ResultTracker();

    const adminA = await this.createSimUser(runId, 'AdminA', Role.ADMIN);
    const [a1, a2, a3, a4] = await Promise.all([
      this.createSimUser(runId, 'A1'),
      this.createSimUser(runId, 'A2'),
      this.createSimUser(runId, 'A3'),
      this.createSimUser(runId, 'A4'),
    ]);
    const members = [a1, a2, a3, a4];

    const circleA = await this.circle.createCircle(adminA.id, {
      name: `${runId}_CircleA`,
      contributionAmount: '100000',
      maxSlots: 4,
      durationCycles: 4,
      frequency: 'WEEKLY',
      payoutLogic: PayoutLogic.SEQUENTIAL,
      visibility: 'PUBLIC',
    });
    circleIds.push(circleA.id);

    for (const u of members) {
      await this.membership.requestToJoin(u.id, circleA.id);
      await this.membership.approveMember(circleA.id, adminA.id, u.id);
    }

    await this.circle.activateCircle(circleA.id, new Date(Date.now() + 30 * 60 * 1000));
    await tracker.snapshot(this.prisma, members);

    for (let cycle = 1; cycle <= 4; cycle++) {
      await this.setScheduleMode(circleA.id, cycle, 'on_time');
      for (const u of members) {
        await this.contributions.makeContribution(u.id, circleA.id, cycle);
      }
      await tracker.record(this.prisma, members, `${cycle}`, 'all on-time');
      await this.payout.processPayout(circleA.id, cycle);
      await tracker.record(this.prisma, members, `${cycle}`, 'after payout');
    }

    // Peer reviews — fair ratings 4–5
    const ratings: Record<string, number> = { A1: 5, A2: 4, A3: 4, A4: 5 };
    for (const reviewer of members) {
      for (const reviewee of members) {
        if (reviewer.id === reviewee.id) continue;
        await this.peerReview.submitReview(circleA.id, reviewer.id, {
          revieweeId: reviewee.id,
          rating: ratings[reviewee.label] ?? 4,
          comment: 'Good contributor',
        });
      }
    }
    await tracker.record(this.prisma, members, 'post', 'peer reviews (fair 4–5)');

    return tracker.toResult(runId, this.prisma, members);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: Circle B — Mixed (late + malicious ratings + missed)
  // ═══════════════════════════════════════════════════════════════════════════

  private async runCircleB(runId: string, circleIds: string[]): Promise<SimResult> {
    const tracker = new ResultTracker();

    const adminB = await this.createSimUser(runId, 'AdminB', Role.ADMIN);
    const [b1, b2, b3, b4] = await Promise.all([
      this.createSimUser(runId, 'B1'),
      this.createSimUser(runId, 'B2'),
      this.createSimUser(runId, 'B3'),
      this.createSimUser(runId, 'B4'),
    ]);
    const members = [b1, b2, b3, b4];

    const circleB = await this.circle.createCircle(adminB.id, {
      name: `${runId}_CircleB`,
      contributionAmount: '100000',
      maxSlots: 4,
      durationCycles: 4,
      frequency: 'WEEKLY',
      payoutLogic: PayoutLogic.SEQUENTIAL,
      visibility: 'PUBLIC',
    });
    circleIds.push(circleB.id);

    for (const u of members) {
      await this.membership.requestToJoin(u.id, circleB.id);
      await this.membership.approveMember(circleB.id, adminB.id, u.id);
    }

    await this.circle.activateCircle(circleB.id, new Date(Date.now() + 30 * 60 * 1000));
    await tracker.snapshot(this.prisma, members);

    for (let cycle = 1; cycle <= 4; cycle++) {
      if (cycle === 2) {
        // B1, B3, B4 on-time; B2 late
        await this.setScheduleMode(circleB.id, cycle, 'on_time');
        await this.contributions.makeContribution(b1.id, circleB.id, cycle);
        await this.contributions.makeContribution(b3.id, circleB.id, cycle);
        await this.contributions.makeContribution(b4.id, circleB.id, cycle);
        await this.setScheduleMode(circleB.id, cycle, 'late');
        await this.contributions.makeContribution(b2.id, circleB.id, cycle);
        await tracker.record(this.prisma, members, `${cycle}`, 'B2 late, rest on-time');
      } else if (cycle === 3) {
        // B4 misses — auto missed_payment via processPayout
        await this.setScheduleMode(circleB.id, cycle, 'on_time');
        await this.contributions.makeContribution(b1.id, circleB.id, cycle);
        await this.contributions.makeContribution(b2.id, circleB.id, cycle);
        await this.contributions.makeContribution(b3.id, circleB.id, cycle);
        await tracker.record(this.prisma, members, `${cycle}`, 'B4 missed');
      } else {
        await this.setScheduleMode(circleB.id, cycle, 'on_time');
        for (const u of members) {
          await this.contributions.makeContribution(u.id, circleB.id, cycle);
        }
        await tracker.record(this.prisma, members, `${cycle}`, 'all on-time');
      }

      await this.payout.processPayout(circleB.id, cycle);
      await tracker.record(this.prisma, members, `${cycle}`, 'after payout');
    }

    // Peer reviews — B3 gives malicious 1s
    for (const reviewer of members) {
      for (const reviewee of members) {
        if (reviewer.id === reviewee.id) continue;
        let rating: number;
        if (reviewer.id === b3.id) rating = 1;
        else if (reviewee.id === b3.id) rating = 3;
        else rating = 4;
        await this.peerReview.submitReview(circleB.id, reviewer.id, { revieweeId: reviewee.id, rating });
      }
    }
    await tracker.record(this.prisma, members, 'post', 'peer reviews (B3 malicious 1s)');

    return tracker.toResult(runId, this.prisma, members);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: Circle C — Worst case (defaults, post-payout default, loan)
  // ═══════════════════════════════════════════════════════════════════════════

  private async runCircleC(runId: string, circleIds: string[]): Promise<SimResult> {
    const tracker = new ResultTracker();

    const adminC = await this.createSimUser(runId, 'AdminC', Role.ADMIN);
    const [c1, c2, c3, c4] = await Promise.all([
      this.createSimUser(runId, 'C1'),
      this.createSimUser(runId, 'C2'),
      this.createSimUser(runId, 'C3'),
      this.createSimUser(runId, 'C4'),
    ]);
    const members = [c1, c2, c3, c4];

    const circleC = await this.circle.createCircle(adminC.id, {
      name: `${runId}_CircleC`,
      contributionAmount: '100000',
      maxSlots: 4,
      durationCycles: 4,
      frequency: 'WEEKLY',
      payoutLogic: PayoutLogic.ADMIN_ASSIGNED,
      visibility: 'PUBLIC',
    });
    circleIds.push(circleC.id);

    for (const u of members) {
      await this.membership.requestToJoin(u.id, circleC.id);
      await this.membership.approveMember(circleC.id, adminC.id, u.id);
    }

    // Payout order: C2→cycle1, C3→cycle2, C1→cycle3, C4→cycle4
    await this.circle.updatePayoutConfiguration(circleC.id, adminC.id, {
      payoutLogic: PayoutLogic.ADMIN_ASSIGNED,
      assignments: [
        { userId: c2.id, position: 1 },
        { userId: c3.id, position: 2 },
        { userId: c1.id, position: 3 },
        { userId: c4.id, position: 4 },
      ],
    });

    await this.circle.activateCircle(circleC.id, new Date(Date.now() + 30 * 60 * 1000));
    await tracker.snapshot(this.prisma, members);

    // C3 takes a loan before their payout cycle (cycle 2)
    await this.loanService.applyLoan(c3.id, circleC.id);

    for (let cycle = 1; cycle <= 4; cycle++) {
      await this.setScheduleMode(circleC.id, cycle, 'on_time');

      if (cycle === 1) {
        // C1 misses
        await this.contributions.makeContribution(c2.id, circleC.id, cycle);
        await this.contributions.makeContribution(c3.id, circleC.id, cycle);
        await this.contributions.makeContribution(c4.id, circleC.id, cycle);
        await tracker.record(this.prisma, members, `${cycle}`, 'C1 missed');
      } else if (cycle === 2) {
        // C1 misses again; C3 payout (loan deducted)
        await this.contributions.makeContribution(c2.id, circleC.id, cycle);
        await this.contributions.makeContribution(c3.id, circleC.id, cycle);
        await this.contributions.makeContribution(c4.id, circleC.id, cycle);
        await tracker.record(this.prisma, members, `${cycle}`, 'C1 missed again');
      } else if (cycle === 3) {
        // C1 receives payout; C1+C2 miss (missed_payment auto-fired)
        await this.contributions.makeContribution(c3.id, circleC.id, cycle);
        await this.contributions.makeContribution(c4.id, circleC.id, cycle);
        await tracker.record(this.prisma, members, `${cycle}`, 'C1+C2 missed');
      } else {
        // Cycle 4: C1+C2 miss (C1 is post-payout)
        await this.contributions.makeContribution(c3.id, circleC.id, cycle);
        await this.contributions.makeContribution(c4.id, circleC.id, cycle);
        await tracker.record(this.prisma, members, `${cycle}`, 'C1+C2 missed (C1 post-payout)');
      }

      await this.payout.processPayout(circleC.id, cycle);
      await tracker.record(this.prisma, members, `${cycle}`, 'after payout');

      // After cycle 4: escalate C1 to post-payout default
      if (cycle === 4) {
        await this.trustService.fireTrustEventAdmin(c1.id, { type: 'missed_payment_post_payout_default' });
        await tracker.record(this.prisma, [c1], `${cycle}`, 'C1 post-payout-default escalation');
      }
    }

    // Peer reviews
    for (const reviewer of members) {
      for (const reviewee of members) {
        if (reviewer.id === reviewee.id) continue;
        let rating: number;
        if (reviewee.id === c1.id) rating = 1;
        else if (reviewee.id === c2.id) rating = 2;
        else rating = 4;
        await this.peerReview.submitReview(circleC.id, reviewer.id, { revieweeId: reviewee.id, rating });
      }
    }
    await tracker.record(this.prisma, members, 'post', 'peer reviews (C1/C2 low, C3/C4 fair)');

    return tracker.toResult(runId, this.prisma, members);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: Manual simulation executor
  // ═══════════════════════════════════════════════════════════════════════════

  private async executeManualSim(
    runId: string,
    circleIdBucket: string[],
    config: ManualSimConfigDto,
  ): Promise<SimResult> {
    const tracker = new ResultTracker();
    const contributionAmount = BigInt(config.contributionAmountKobo);

    // Create admin + members
    const admin = await this.createSimUser(runId, 'Admin', Role.ADMIN, contributionAmount);
    const memberMap = new Map<string, SimUser>();

    for (const mc of config.members) {
      const u = await this.createSimUser(runId, mc.label, Role.MEMBER, contributionAmount);
      memberMap.set(mc.label, u);
    }

    const members = config.members.map((mc) => memberMap.get(mc.label)!);

    // Create & activate circle
    const newCircle = await this.circle.createCircle(admin.id, {
      name: `${runId}_${config.circleName}`,
      contributionAmount: config.contributionAmountKobo.toString(),
      maxSlots: config.maxSlots,
      durationCycles: config.members.length,
      frequency: config.frequency,
      payoutLogic: config.payoutLogic as PayoutLogic,
      visibility: 'PUBLIC',
    });
    circleIdBucket.push(newCircle.id);

    for (const u of members) {
      await this.membership.requestToJoin(u.id, newCircle.id);
      await this.membership.approveMember(newCircle.id, admin.id, u.id);
    }

    if (config.payoutLogic === 'ADMIN_ASSIGNED') {
      await this.circle.updatePayoutConfiguration(newCircle.id, admin.id, {
        payoutLogic: PayoutLogic.ADMIN_ASSIGNED,
        assignments: config.members.map((mc) => ({
          userId: memberMap.get(mc.label)!.id,
          position: mc.payoutPosition,
        })),
      });
    }

    await this.circle.activateCircle(newCircle.id, new Date(Date.now() + 30 * 60 * 1000));
    await tracker.snapshot(this.prisma, members);

    // Process cycles
    for (const cycleConf of config.cycles) {
      const { cycleNumber, contributions: contribs } = cycleConf;

      // Group into on-time / late / missed
      const onTimers = contribs.filter((c) => c.timing === 'on_time').map((c) => memberMap.get(c.member)!);
      const lateOnes = contribs.filter((c) => c.timing === 'late').map((c) => memberMap.get(c.member)!);

      // On-time first (deadline in future)
      if (onTimers.length > 0) {
        await this.setScheduleMode(newCircle.id, cycleNumber, 'on_time');
        for (const u of onTimers) {
          await this.contributions.makeContribution(u.id, newCircle.id, cycleNumber);
        }
      }

      // Late contributors (deadline in past)
      if (lateOnes.length > 0) {
        await this.setScheduleMode(newCircle.id, cycleNumber, 'late');
        for (const u of lateOnes) {
          await this.contributions.makeContribution(u.id, newCircle.id, cycleNumber);
        }
        // Reset to on-time so payout can proceed
        await this.setScheduleMode(newCircle.id, cycleNumber, 'on_time');
      }

      const eventLabel = contribs
        .map((c) => `${c.member}:${c.timing}`)
        .join(', ');
      await tracker.record(this.prisma, members, `${cycleNumber}`, eventLabel);

      await this.payout.processPayout(newCircle.id, cycleNumber);
      await tracker.record(this.prisma, members, `${cycleNumber}`, 'after payout');

      // Extra trust events after this cycle
      for (const evt of cycleConf.extraTrustEvents ?? []) {
        const targetUser = memberMap.get(evt.member);
        if (!targetUser) continue;
        const trustEvent = this.mapExtraTrustEvent(evt);
        await this.trustService.fireTrustEventAdmin(targetUser.id, trustEvent);
        await tracker.record(this.prisma, [targetUser], `${cycleNumber}`, `extra: ${evt.event}${evt.note ? ` (${evt.note})` : ''}`);
      }
    }

    // Peer reviews
    for (const pr of config.peerReviews ?? []) {
      const reviewer = memberMap.get(pr.reviewer);
      const reviewee = memberMap.get(pr.reviewee);
      if (!reviewer || !reviewee) continue;
      await this.peerReview.submitReview(newCircle.id, reviewer.id, {
        revieweeId: reviewee.id,
        rating: pr.rating,
        comment: pr.comment,
      });
    }

    if (config.peerReviews && config.peerReviews.length > 0) {
      await tracker.record(this.prisma, members, 'post', 'peer reviews applied');
    }

    return tracker.toResult(runId, this.prisma, members);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE: Shared helpers
  // ═══════════════════════════════════════════════════════════════════════════

  private async createSimUser(
    runId: string,
    label: string,
    role: Role = Role.MEMBER,
    contributionAmount: bigint = 100_000n,
  ): Promise<SimUser> {
    const id = crypto.randomUUID();
    const email = `${runId}_${label.toLowerCase().replace(/\s/g, '_')}@sim.test`;

    await this.prisma.user.create({
      data: {
        id,
        email,
        firstName: 'Sim',
        lastName: label,
        password: 'SIM_LOCKED',
        gender: Gender.MALE,
        phone: `+234${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`,
        role,
        isVerified: true,
        dob: new Date('1990-01-01'),
      },
    });

    const wallet = await this.prisma.wallet.create({ data: { userId: id } });

    await this.prisma.userTrustStats.upsert({
      where: { userId: id },
      update: {},
      create: { userId: id, trustScore: 50 },
    });

    // Fund with 20× the contribution amount to cover cycles + collateral
    const fundAmount = contributionAmount * 20n > WALLET_FUND_AMOUNT
      ? contributionAmount * 20n
      : WALLET_FUND_AMOUNT;

    await this.ledger.writeEntry({
      walletId: wallet.id,
      entryType: EntryType.CREDIT,
      movementType: MovementType.FUNDING,
      amount: fundAmount,
      reference: `SIM-FUND-${crypto.randomUUID()}`,
      sourceType: LedgerSourceType.TRANSACTION,
      sourceId: `sim-fund-${id}-${Date.now()}`,
      metadata: { note: 'simulation funding' },
    });

    return { id, label, email, walletId: wallet.id };
  }

  private async setScheduleMode(
    circleId: string,
    cycleNumber: number,
    mode: 'on_time' | 'late',
  ): Promise<void> {
    const now = new Date();
    const contributionDeadline =
      mode === 'on_time'
        ? new Date(now.getTime() + 60 * 60 * 1000)   // +1 hour
        : new Date(now.getTime() - 30 * 60 * 1000);   // -30 minutes
    const payoutDate = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    await this.prisma.roscaCycleSchedule.updateMany({
      where: { circleId, cycleNumber, obsoletedAt: null },
      data: { contributionDeadline, payoutDate },
    });
  }

  private mapExtraTrustEvent(e: ExtraTrustEventDto): TrustScoreEvent {
    const type = e.event as ExtraTrustEventType;
    switch (type) {
      case 'contribution_on_time':
        return { type: 'contribution', onTime: true, isPostPayout: e.isPostPayout ?? false };
      case 'contribution_late':
        return { type: 'contribution', onTime: false, isPostPayout: e.isPostPayout ?? false };
      case 'missed_payment':
        return { type: 'missed_payment', isPostPayout: false };
      case 'missed_payment_post_payout':
        return { type: 'missed_payment', isPostPayout: true };
      case 'missed_payment_post_payout_default':
        return { type: 'missed_payment_post_payout_default' };
      case 'peer_rating':
        return { type: 'peer_rating', rating: e.rating! };
      case 'cycle_reset':
        return { type: 'cycle_reset' };
    }
  }

  private async cleanupSimRecords(runId: string, circleIds: string[]): Promise<void> {
    // All deletes run against the simulation database (SIM_NEON_DB_URL).
    // The real database is never touched.

    if (circleIds.length > 0) {
      await this.prisma.peerReview.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.roscaPayout.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.roscaContribution.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.roscaCycleSchedule.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.loan.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.roscaInvite.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.missedContributionDebt.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.roscaMembership.deleteMany({ where: { circleId: { in: circleIds } } });
      await this.prisma.roscaCircle.deleteMany({ where: { id: { in: circleIds } } });
      await this.prisma.auditLog.deleteMany({ where: { actorId: 'SYSTEM', entityId: { in: circleIds } } });
    }

    const simUsers = await this.prisma.user.findMany({
      where: { email: { startsWith: runId } },
      select: { id: true },
    });
    const userIds = simUsers.map((u) => u.id);
    if (userIds.length === 0) return;

    const wallets = await this.prisma.wallet.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const walletIds = wallets.map((w) => w.id);

    await this.prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await this.prisma.creditScore.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.userTrustStats.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
    await this.prisma.walletBucket.deleteMany({ where: { walletId: { in: walletIds } } });
    await this.prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

// ── ResultTracker ─────────────────────────────────────────────────────────────
// Collects score snapshots during a simulation and serializes to SimResult.

class ResultTracker {
  private events: SimEventRecord[] = [];
  private snapshots = new Map<string, ScoreSnapshot>();

  async snapshot(prisma: PrismaService, users: SimUser[]): Promise<void> {
    for (const u of users) {
      this.snapshots.set(u.id, await readScore(prisma, u.id));
    }
  }

  async record(
    prisma: PrismaService,
    users: SimUser[],
    cycle: string,
    event: string,
  ): Promise<void> {
    const scores: { memberLabel: string; raw: number; display: number }[] = [];
    for (const u of users) {
      const after = await readScore(prisma, u.id);
      scores.push({ memberLabel: u.label, raw: after.raw, display: after.display });
      this.snapshots.set(u.id, after);
    }
    this.events.push({ cycle, event, scores });
  }

  async toResult(
    runId: string,
    prisma: PrismaService,
    members: SimUser[],
  ): Promise<SimResult> {
    const finalScores: SimMemberResult[] = [];
    for (const u of members) {
      const s = await readScore(prisma, u.id);
      finalScores.push({ label: u.label, finalRaw: s.raw, finalDisplay: s.display });
    }
    return { runId, events: this.events, finalScores };
  }
}

async function readScore(prisma: PrismaService, userId: string): Promise<ScoreSnapshot> {
  const stats = await prisma.userTrustStats.findUnique({ where: { userId } });
  const raw = stats?.trustScore ?? 50;
  return { raw, display: Math.round(300 + raw * 5.5) };
}
