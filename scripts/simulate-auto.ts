/**
 * scripts/simulate-auto.ts
 *
 * Automated ROSCA scenario simulation — 3 circles, 4 cycles each.
 * Uses REAL service methods wired through a NestJS TestingModule.
 * All records are prefixed with a unique run ID so they are safe to run in
 * development and easy to clean up afterwards.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/simulate-auto.ts
 *
 * Clean-up: the script deletes all sim records at the end.
 * Pass --no-cleanup to keep the records for inspection:
 *   npx ts-node -r tsconfig-paths/register scripts/simulate-auto.ts --no-cleanup
 */

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import * as crypto from 'crypto';

// Services
import { PrismaService } from '../src/prisma/prisma.service';
import { SimPrismaService } from '../src/modules/simulation/sim-prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { TrustService } from '../src/modules/trust/trust.service';
import { ContributionService } from '../src/modules/contribution/contribution.service';
import { PayoutService } from '../src/modules/payout/payout.service';
import { MembershipService } from '../src/modules/rosca/services/membership.service';
import { CircleService } from '../src/modules/rosca/services/circle.service';
import { PeerReviewService } from '../src/modules/peer-review/peer-review.service';
import { LoanService } from '../src/modules/loans/loans.service';
import { CreditService } from '../src/modules/credit/credit.service';
import { ExternalCreditService } from '../src/modules/credit/external-credit.service';
import { NotificationService } from '../src/modules/notification/notification.service';

// Prisma enums
import {
  Gender,
  Role,
  EntryType,
  MovementType,
  LedgerSourceType,
  PayoutLogic,
} from '@prisma/client';

// Auth queue token
import { AUTH_EVENTS_QUEUE } from '../src/modules/auth/auth.events';

// ── Types ────────────────────────────────────────────────────────────────────

type ScoreEntry = {
  label: string;
  event: string;
  before: number;
  after: number;
  displayBefore: number;
  displayAfter: number;
};

type SimUser = {
  id: string;
  label: string;
  email: string;
  walletId: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const RUN_ID = `sim_${Date.now()}`;
const CONTRIBUTION_AMOUNT = 100_000n; // ₦1,000 in kobo
const WALLET_FUND_AMOUNT = 2_000_000n; // ₦20,000 — enough for 4 cycles + collateral
const NO_CLEANUP = process.argv.includes('--no-cleanup');

// ── No-op notification provider ──────────────────────────────────────────────
// Prevents real emails/WS pushes from firing during simulation.
function noopNotifications(): Partial<NotificationService> {
  const noop = async () => {};
  return {
    sendMemberApprovedNotification: noop,
    sendMemberRejectedNotification: noop,
    sendCircleStartedNotification: noop,
    sendTopUpReminderNotification: noop,
    sendContributionReminder: noop,
    sendPayoutPositionNotification: noop,
    sendTransactionEmail: noop,
    createInAppNotification: async () => ({ id: 'noop-' + crypto.randomUUID() } as any),
  };
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  const moduleRef = await Test.createTestingModule({
    providers: [
      // SimPrismaService redirects ledgerEntry/walletBucket writes to sim tables,
      // keeping the real append-only ledger completely clean.
      SimPrismaService,
      { provide: PrismaService, useExisting: SimPrismaService },
      LedgerService,
      TrustService,
      ContributionService,
      MembershipService,
      CircleService,
      PayoutService,
      LoanService,
      CreditService,
      ExternalCreditService,
      PeerReviewService,
      // Suppress BullMQ queue — payout notification is fire-and-forget
      { provide: getQueueToken(AUTH_EVENTS_QUEUE), useValue: { add: async () => ({}) } },
      // Suppress real notifications
      { provide: NotificationService, useValue: noopNotifications() },
    ],
  }).compile();

  return moduleRef;
}

// ── Helper: Fund a wallet ─────────────────────────────────────────────────────

async function fundWallet(ledger: LedgerService, walletId: string, amount: bigint, userId: string) {
  await ledger.writeEntry({
    walletId,
    entryType: EntryType.CREDIT,
    movementType: MovementType.FUNDING,
    amount,
    reference: `SIM-FUND-${crypto.randomUUID()}`,
    sourceType: LedgerSourceType.TRANSACTION,
    sourceId: `sim-fund-${userId}-${Date.now()}`,
    metadata: { note: 'simulation funding' },
  });
}

// ── Helper: Create a simulation user + wallet ────────────────────────────────

async function createSimUser(
  prisma: PrismaService,
  ledger: LedgerService,
  label: string,
  role: Role = Role.MEMBER,
): Promise<SimUser> {
  const id = crypto.randomUUID();
  const email = `${RUN_ID}_${label.toLowerCase().replace(/\s/g, '_')}@sim.test`;

  await prisma.user.create({
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

  const wallet = await prisma.wallet.create({ data: { userId: id } });

  // Also create UserTrustStats at baseline 50
  await prisma.userTrustStats.upsert({
    where: { userId: id },
    update: {},
    create: { userId: id, trustScore: 50 },
  });

  await fundWallet(ledger, wallet.id, WALLET_FUND_AMOUNT, id);

  return { id, label, email, walletId: wallet.id };
}

// ── Helper: Read trust score ──────────────────────────────────────────────────

async function readScore(
  prisma: PrismaService,
  userId: string,
): Promise<{ raw: number; display: number }> {
  const stats = await prisma.userTrustStats.findUnique({ where: { userId } });
  const raw = stats?.trustScore ?? 50;
  const display = Math.round(300 + raw * 5.5);
  return { raw, display };
}

// ── Helper: Set schedule dates ─────────────────────────────────────────────────
// Controls whether contributions to this cycle will be on-time or late.
//
// After calling this:
//   mode = 'on_time'  → contributionDeadline is 1 hour in the future
//   mode = 'late'     → contributionDeadline is 30 minutes in the past
//   payoutDate is always 25 hours in the future (so processPayout can be called any time)

async function setScheduleMode(
  prisma: PrismaService,
  circleId: string,
  cycleNumber: number,
  mode: 'on_time' | 'late',
) {
  const now = new Date();
  const contributionDeadline =
    mode === 'on_time'
      ? new Date(now.getTime() + 60 * 60 * 1000)       // +1 hour
      : new Date(now.getTime() - 30 * 60 * 1000);       // -30 minutes
  const payoutDate = new Date(now.getTime() + 25 * 60 * 60 * 1000); // +25 hours

  await prisma.roscaCycleSchedule.updateMany({
    where: { circleId, cycleNumber, obsoletedAt: null },
    data: { contributionDeadline, payoutDate },
  });
}

// ── Helper: Contribute helper ────────────────────────────────────────────────

async function contribute(
  contributions: ContributionService,
  user: SimUser,
  circleId: string,
  cycle: number,
): Promise<void> {
  await contributions.makeContribution(user.id, circleId, cycle);
}

// ── Score Tracker ─────────────────────────────────────────────────────────────

class ScoreTracker {
  private rows: ScoreEntry[] = [];
  private snapshots: Map<string, { raw: number; display: number }> = new Map();

  async snapshot(prisma: PrismaService, users: SimUser[]) {
    for (const u of users) {
      this.snapshots.set(u.id, await readScore(prisma, u.id));
    }
  }

  async record(prisma: PrismaService, users: SimUser[], event: string) {
    for (const u of users) {
      const before = this.snapshots.get(u.id) ?? { raw: 50, display: 575 };
      const after = await readScore(prisma, u.id);
      this.rows.push({
        label: u.label,
        event,
        before: before.raw,
        after: after.raw,
        displayBefore: before.display,
        displayAfter: after.display,
      });
      // Update snapshot for next event
      this.snapshots.set(u.id, after);
    }
  }

  print(title: string) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`  ${title}`);
    console.log('─'.repeat(80));
    console.log(
      'Member'.padEnd(18) +
        'Event'.padEnd(34) +
        'Score (raw)'.padEnd(14) +
        'Score (display)',
    );
    console.log('─'.repeat(80));
    for (const r of this.rows) {
      const rawDiff = r.after - r.before;
      const rawStr = `${r.before} → ${r.after} (${rawDiff >= 0 ? '+' : ''}${rawDiff})`;
      const dispDiff = r.displayAfter - r.displayBefore;
      const dispStr = `${r.displayBefore} → ${r.displayAfter} (${dispDiff >= 0 ? '+' : ''}${dispDiff})`;
      console.log(r.label.padEnd(18) + r.event.padEnd(34) + rawStr.padEnd(14) + dispStr);
    }
    console.log('─'.repeat(80));
  }
}

// ── Main simulation function ──────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ROSCA Trust Score Simulation  [Run ID: ${RUN_ID}]`);
  console.log('═'.repeat(80));
  console.log('  Using REAL service methods on the REAL database.');
  console.log('  Notification emails and queue jobs are suppressed.\n');

  const moduleRef = await bootstrap();
  const prisma = moduleRef.get(SimPrismaService);
  const ledger = moduleRef.get(LedgerService);
  const trustService = moduleRef.get(TrustService);
  const contributions = moduleRef.get(ContributionService);
  const payout = moduleRef.get(PayoutService);
  const membership = moduleRef.get(MembershipService);
  const circle = moduleRef.get(CircleService);
  const peerReview = moduleRef.get(PeerReviewService);
  const loanService = moduleRef.get(LoanService);

  const circleIds: string[] = [];

  try {
    // ══════════════════════════════════════════════════════════════════════════
    // CIRCLE A — Best Case (4 members, all on-time, fair peer ratings)
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n[Circle A] Setting up: BEST CASE (all on-time, fair peer ratings)');

    const adminA = await createSimUser(prisma, ledger, 'AdminA', Role.ADMIN);
    const [a1, a2, a3, a4] = await Promise.all([
      createSimUser(prisma, ledger, 'A1'),
      createSimUser(prisma, ledger, 'A2'),
      createSimUser(prisma, ledger, 'A3'),
      createSimUser(prisma, ledger, 'A4'),
    ]);
    const membersA = [a1, a2, a3, a4];

    const circleA = await circle.createCircle(adminA.id, {
      name: `${RUN_ID} Circle A`,
      contributionAmount: CONTRIBUTION_AMOUNT.toString(),
      maxSlots: 4,
      durationCycles: 4, // overwritten to actual member count on activation
      frequency: 'WEEKLY',
      payoutLogic: PayoutLogic.SEQUENTIAL,
      visibility: 'PUBLIC',
    });
    circleIds.push(circleA.id);

    // Members join and admin approves
    for (const u of membersA) {
      await membership.requestToJoin(u.id, circleA.id);
      await membership.approveMember(circleA.id, adminA.id, u.id);
    }

    // Activate with initial deadline 30 minutes from now
    const deadlineA = new Date(Date.now() + 30 * 60 * 1000);
    await circle.activateCircle(circleA.id, deadlineA);
    console.log('[Circle A] Activated. Running 4 cycles...');

    const trackerA = new ScoreTracker();
    await trackerA.snapshot(prisma, membersA);

    for (let cycle = 1; cycle <= 4; cycle++) {
      // Set all schedule dates so contributions are on-time
      await setScheduleMode(prisma, circleA.id, cycle, 'on_time');

      for (const u of membersA) {
        await contribute(contributions, u, circleA.id, cycle);
      }
      await trackerA.record(prisma, membersA, `Cycle ${cycle}: on-time contribution`);

      await payout.processPayout(circleA.id, cycle);
      await trackerA.record(prisma, membersA, `Cycle ${cycle}: after payout`);

      console.log(`  [Circle A] Cycle ${cycle} complete`);
    }

    // Peer reviews — circle is now COMPLETED
    const reviewRatingsA: Record<string, number> = { A1: 5, A2: 4, A3: 4, A4: 5 };
    for (const reviewer of membersA) {
      for (const reviewee of membersA) {
        if (reviewer.id === reviewee.id) continue;
        const rating = reviewRatingsA[reviewee.label] ?? 4;
        await peerReview.submitReview(circleA.id, reviewer.id, {
          revieweeId: reviewee.id,
          rating,
          comment: 'Good contributor',
        });
      }
    }
    await trackerA.record(prisma, membersA, 'Peer reviews (fair ratings 4–5)');
    trackerA.print('CIRCLE A — Best Case Results');

    // ══════════════════════════════════════════════════════════════════════════
    // CIRCLE B — Mixed Behaviour
    //   B1: always on-time, fair ratings (4-5)
    //   B2: late in cycle 2, on-time otherwise, fair ratings
    //   B3: always on-time, malicious ratings (all 1s)
    //   B4: misses cycle 3, recovers cycle 4
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n[Circle B] Setting up: MIXED (late payment + malicious ratings + missed cycle)');

    const adminB = await createSimUser(prisma, ledger, 'AdminB', Role.ADMIN);
    const [b1, b2, b3, b4] = await Promise.all([
      createSimUser(prisma, ledger, 'B1'),
      createSimUser(prisma, ledger, 'B2'),
      createSimUser(prisma, ledger, 'B3'),
      createSimUser(prisma, ledger, 'B4'),
    ]);
    const membersB = [b1, b2, b3, b4];

    const circleB = await circle.createCircle(adminB.id, {
      name: `${RUN_ID} Circle B`,
      contributionAmount: CONTRIBUTION_AMOUNT.toString(),
      maxSlots: 4,
      durationCycles: 4,
      frequency: 'WEEKLY',
      payoutLogic: PayoutLogic.SEQUENTIAL,
      visibility: 'PUBLIC',
    });
    circleIds.push(circleB.id);

    for (const u of membersB) {
      await membership.requestToJoin(u.id, circleB.id);
      await membership.approveMember(circleB.id, adminB.id, u.id);
    }

    const deadlineB = new Date(Date.now() + 30 * 60 * 1000);
    await circle.activateCircle(circleB.id, deadlineB);
    console.log('[Circle B] Activated. Running 4 cycles...');

    const trackerB = new ScoreTracker();
    await trackerB.snapshot(prisma, membersB);

    for (let cycle = 1; cycle <= 4; cycle++) {
      // --- Contributions ---
      if (cycle === 2) {
        // B2 is late in cycle 2; everyone else on-time
        await setScheduleMode(prisma, circleB.id, cycle, 'on_time');
        await contribute(contributions, b1, circleB.id, cycle);
        await contribute(contributions, b3, circleB.id, cycle);

        // B4 on-time too
        await contribute(contributions, b4, circleB.id, cycle);

        // Now flip deadline to past for B2
        await setScheduleMode(prisma, circleB.id, cycle, 'late');
        await contribute(contributions, b2, circleB.id, cycle);

        await trackerB.record(prisma, membersB, `Cycle ${cycle}: B2 late, rest on-time`);
      } else if (cycle === 3) {
        // B4 misses cycle 3 (do NOT contribute for B4)
        await setScheduleMode(prisma, circleB.id, cycle, 'on_time');
        await contribute(contributions, b1, circleB.id, cycle);
        await contribute(contributions, b2, circleB.id, cycle);
        await contribute(contributions, b3, circleB.id, cycle);
        // B4 intentionally not contributed → recordMissedContributions fires missed_payment

        await trackerB.record(prisma, membersB, `Cycle ${cycle}: B4 missed`);
      } else {
        // Cycles 1 and 4: all on-time
        await setScheduleMode(prisma, circleB.id, cycle, 'on_time');
        for (const u of membersB) {
          await contribute(contributions, u, circleB.id, cycle);
        }
        await trackerB.record(prisma, membersB, `Cycle ${cycle}: all on-time`);
      }

      // processPayout fires recordMissedContributions → auto missed_payment for B4 in cycle 3
      await payout.processPayout(circleB.id, cycle);
      await trackerB.record(prisma, membersB, `Cycle ${cycle}: after payout`);

      console.log(`  [Circle B] Cycle ${cycle} complete`);
    }

    // Peer reviews — B3 gives malicious 1s to everyone
    for (const reviewer of membersB) {
      for (const reviewee of membersB) {
        if (reviewer.id === reviewee.id) continue;
        let rating: number;
        if (reviewer.id === b3.id) {
          rating = 1; // B3: malicious
        } else if (reviewee.id === b3.id) {
          rating = 3; // Others give B3 a low-but-fair score
        } else {
          rating = 4; // Fair ratings among others
        }
        await peerReview.submitReview(circleB.id, reviewer.id, {
          revieweeId: reviewee.id,
          rating,
        });
      }
    }
    await trackerB.record(prisma, membersB, 'Peer reviews (B3 malicious 1s, rest fair)');
    trackerB.print('CIRCLE B — Mixed Behaviour Results');

    // ══════════════════════════════════════════════════════════════════════════
    // CIRCLE C — Worst Case
    //   C1: misses cycles 1 & 2, receives payout cycle 3, misses cycle 4
    //       → gets missed_payment_post_payout_default after cycle 4
    //   C2: on-time cycles 1–2, misses cycles 3–4
    //   C3: always on-time, has active loan → payout cycle 2 is net (loan repaid)
    //   C4: always on-time, fair ratings
    //
    //   Payout order (ADMIN_ASSIGNED): Cycle1→C2, Cycle2→C3, Cycle3→C1, Cycle4→C4
    // ══════════════════════════════════════════════════════════════════════════
    console.log('\n[Circle C] Setting up: WORST CASE (defaults, missed, post-payout default, loan)');

    const adminC = await createSimUser(prisma, ledger, 'AdminC', Role.ADMIN);
    const [c1, c2, c3, c4] = await Promise.all([
      createSimUser(prisma, ledger, 'C1'),
      createSimUser(prisma, ledger, 'C2'),
      createSimUser(prisma, ledger, 'C3'),
      createSimUser(prisma, ledger, 'C4'),
    ]);
    const membersC = [c1, c2, c3, c4];

    const circleC = await circle.createCircle(adminC.id, {
      name: `${RUN_ID} Circle C`,
      contributionAmount: CONTRIBUTION_AMOUNT.toString(),
      maxSlots: 4,
      durationCycles: 4,
      frequency: 'WEEKLY',
      payoutLogic: PayoutLogic.ADMIN_ASSIGNED,
      visibility: 'PUBLIC',
    });
    circleIds.push(circleC.id);

    for (const u of membersC) {
      await membership.requestToJoin(u.id, circleC.id);
      await membership.approveMember(circleC.id, adminC.id, u.id);
    }

    // Assign payout positions (ADMIN_ASSIGNED):
    //   Cycle 1 → C2 (position 1)
    //   Cycle 2 → C3 (position 2)
    //   Cycle 3 → C1 (position 3)
    //   Cycle 4 → C4 (position 4)
    await circle.updatePayoutConfiguration(circleC.id, adminC.id, {
      payoutLogic: PayoutLogic.ADMIN_ASSIGNED,
      assignments: [
        { userId: c2.id, position: 1 },
        { userId: c3.id, position: 2 },
        { userId: c1.id, position: 3 },
        { userId: c4.id, position: 4 },
      ],
    });

    const deadlineC = new Date(Date.now() + 30 * 60 * 1000);
    await circle.activateCircle(circleC.id, deadlineC);
    console.log('[Circle C] Activated. Running 4 cycles...');

    // C3 takes a loan before cycle 2 (their payout cycle)
    // This simulates HELD/reduced payout due to outstanding debt
    console.log('  [Circle C] C3 applying for a loan (will be deducted from cycle 2 payout)...');
    const loanResult = await loanService.applyLoan(c3.id, circleC.id);
    console.log(
      `  [Circle C] C3 loan disbursed: amount=${loanResult.loanAmount} kobo` +
        ` (fee=${loanResult.companyFee} kobo)`,
    );

    const trackerC = new ScoreTracker();
    await trackerC.snapshot(prisma, membersC);

    for (let cycle = 1; cycle <= 4; cycle++) {
      console.log(`  [Circle C] Processing cycle ${cycle}...`);

      await setScheduleMode(prisma, circleC.id, cycle, 'on_time');

      if (cycle === 1) {
        // C1 MISSES cycle 1, C2/C3/C4 on-time
        await contribute(contributions, c2, circleC.id, cycle);
        await contribute(contributions, c3, circleC.id, cycle);
        await contribute(contributions, c4, circleC.id, cycle);
        // C1 does NOT contribute → missed_payment via recordMissedContributions
        await trackerC.record(prisma, membersC, `Cycle ${cycle}: C1 missed`);

      } else if (cycle === 2) {
        // C1 MISSES again, C2/C3/C4 on-time
        // C3 is the payout recipient; their loan will be deducted
        await contribute(contributions, c2, circleC.id, cycle);
        await contribute(contributions, c3, circleC.id, cycle);
        await contribute(contributions, c4, circleC.id, cycle);
        await trackerC.record(prisma, membersC, `Cycle ${cycle}: C1 missed, C3 contributed`);

      } else if (cycle === 3) {
        // C1 receives payout this cycle (position 3)
        // C2 begins defaulting (misses); C1 and C4 contribute
        // NOTE: C1 receives payout even without contributing — pot comes from C3+C4 contributions
        await contribute(contributions, c3, circleC.id, cycle);
        await contribute(contributions, c4, circleC.id, cycle);
        // C1 and C2 miss → missed_payment via recordMissedContributions
        await trackerC.record(prisma, membersC, `Cycle ${cycle}: C1 & C2 missed`);

      } else {
        // Cycle 4: C3 & C4 on-time; C1 & C2 miss (C1 is POST-PAYOUT default)
        await contribute(contributions, c3, circleC.id, cycle);
        await contribute(contributions, c4, circleC.id, cycle);
        await trackerC.record(prisma, membersC, `Cycle ${cycle}: C1 & C2 missed (post-payout for C1)`);
      }

      // processPayout auto-fires missed_payment for non-contributors
      const payoutResult = await payout.processPayout(circleC.id, cycle);

      if (cycle === 2) {
        console.log(
          `  [Circle C] Cycle 2 payout: C3 received ${payoutResult.amount} kobo gross` +
            ` (loan deducted — net amount credited to wallet)`,
        );
      }
      if (cycle === 3) {
        console.log(`  [Circle C] Cycle 3 payout: C1 received payout despite defaulting on cycles 1–2`);
      }

      await trackerC.record(prisma, membersC, `Cycle ${cycle}: after payout`);

      // After cycle 4 payout: escalate C1 to post-payout default
      // processPayout already fired missed_payment for C1; now fire the escalation
      if (cycle === 4) {
        console.log('  [Circle C] Escalating C1 to post-payout default (received payout in cycle 3 then defaulted)...');
        await trustService.fireTrustEventAdmin(c1.id, { type: 'missed_payment_post_payout_default' });
        await trackerC.record(prisma, [c1], `Cycle ${cycle}: C1 post-payout-default escalation`);
      }

      console.log(`  [Circle C] Cycle ${cycle} complete`);
    }

    // Peer reviews (circle is COMPLETED)
    for (const reviewer of membersC) {
      for (const reviewee of membersC) {
        if (reviewer.id === reviewee.id) continue;
        let rating: number;
        if (reviewee.id === c1.id) rating = 1;      // C1 defaulted twice
        else if (reviewee.id === c2.id) rating = 2; // C2 disappeared
        else rating = 4;                             // C3/C4 reliable
        await peerReview.submitReview(circleC.id, reviewer.id, { revieweeId: reviewee.id, rating });
      }
    }
    await trackerC.record(prisma, membersC, 'Peer reviews (C1/C2 low, C3/C4 fair)');
    trackerC.print('CIRCLE C — Worst Case Results');

    // ── Final Summary ─────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(80));
    console.log('  FINAL TRUST SCORES (after all circles and peer reviews)');
    console.log('═'.repeat(80));
    const allUsers = [
      ...membersA,
      ...membersB,
      ...membersC,
    ];
    for (const u of allUsers) {
      const s = await readScore(prisma, u.id);
      console.log(`  ${u.label.padEnd(6)}  raw=${String(s.raw).padEnd(4)}  display=${s.display}`);
    }
    console.log('═'.repeat(80));

  } finally {
    if (!NO_CLEANUP) {
      console.log(`\n[Cleanup] Deleting simulation records with prefix "${RUN_ID}"...`);
      await cleanupSimRecords(prisma, RUN_ID, circleIds);
      console.log('[Cleanup] Done.');
    } else {
      console.log(`\n[Cleanup] Skipped (--no-cleanup). Records are in the DB with run ID: ${RUN_ID}`);
    }
    await moduleRef.close();
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

async function cleanupSimRecords(
  prisma: SimPrismaService,
  runId: string,
  circleIds: string[],
) {
  if (circleIds.length > 0) {
    // Delete ROSCA business records in child-first order
    await prisma.peerReview.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.roscaPayout.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.roscaContribution.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.roscaCycleSchedule.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.loan.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.roscaInvite.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.missedContributionDebt.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.roscaMembership.deleteMany({ where: { circleId: { in: circleIds } } });
    await prisma.roscaCircle.deleteMany({ where: { id: { in: circleIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: 'SYSTEM', entityId: { in: circleIds } } });
  }

  const simUsers = await prisma.user.findMany({
    where: { email: { startsWith: runId } },
    select: { id: true },
  });
  const simUserIds = simUsers.map((u) => u.id);
  if (simUserIds.length === 0) return;

  const wallets = await prisma.wallet.findMany({
    where: { userId: { in: simUserIds } },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);

  // prisma.ledgerEntry → redirected to sim_ledger_entries (append-only ledger stays clean)
  // prisma.walletBucket → redirected to sim_wallet_buckets
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.walletBucket.deleteMany({ where: { walletId: { in: walletIds } } });

  // Now real wallet/user can be deleted (no FK references remain)
  await prisma.auditLog.deleteMany({ where: { actorId: { in: simUserIds } } });
  await prisma.creditScore.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.userTrustStats.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: simUserIds } } });
}

// ── Entry point ──────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error('\n[FATAL] Simulation failed:', err);
  process.exit(1);
});
