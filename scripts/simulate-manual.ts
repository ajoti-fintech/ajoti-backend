/**
 * scripts/simulate-manual.ts
 *
 * Manual cycle-by-cycle ROSCA simulation driven by a JSON config file.
 * Uses REAL service methods — no mocking of business logic.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/simulate-manual.ts
 *   npx ts-node -r tsconfig-paths/register scripts/simulate-manual.ts path/to/your-config.json
 *
 * Pass --no-cleanup to keep DB records for inspection.
 *
 * Config schema: see scripts/simulate-manual-config.json for a full example.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';

import { PrismaService } from '../src/prisma/prisma.service';
import { SimPrismaService } from '../src/modules/simulation/sim-prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { TrustService } from '../src/modules/trust/trust.service';
import type { TrustScoreEvent } from '../src/modules/trust/trust.service';
import { ContributionService } from '../src/modules/contribution/contribution.service';
import { PayoutService } from '../src/modules/payout/payout.service';
import { MembershipService } from '../src/modules/rosca/services/membership.service';
import { CircleService } from '../src/modules/rosca/services/circle.service';
import { PeerReviewService } from '../src/modules/peer-review/peer-review.service';
import { LoanService } from '../src/modules/loans/loans.service';
import { CreditService } from '../src/modules/credit/credit.service';
import { ExternalCreditService } from '../src/modules/credit/external-credit.service';
import { NotificationService } from '../src/modules/notification/notification.service';

import {
  Gender,
  Role,
  EntryType,
  MovementType,
  LedgerSourceType,
  PayoutLogic,
} from '@prisma/client';

import { AUTH_EVENTS_QUEUE } from '../src/modules/auth/auth.events';

// ── Config types ──────────────────────────────────────────────────────────────

type Timing = 'on_time' | 'late' | 'missed';

type ExtraTrustEventType =
  | 'contribution_on_time'
  | 'contribution_late'
  | 'missed_payment'
  | 'missed_payment_post_payout'
  | 'missed_payment_post_payout_default'
  | 'peer_rating'
  | 'cycle_reset';

interface ExtraTrustEvent {
  member: string;
  event: ExtraTrustEventType;
  rating?: number;        // required for peer_rating
  isPostPayout?: boolean; // for contribution events
  note?: string;
}

interface CycleContribution {
  member: string;
  timing: Timing;
}

interface CycleConfig {
  cycleNumber: number;
  contributions: CycleContribution[];
  extraTrustEvents?: ExtraTrustEvent[];
}

interface PeerReviewConfig {
  reviewer: string;
  reviewee: string;
  rating: number;
  comment?: string;
}

interface MemberConfig {
  label: string;
  payoutPosition: number;
}

interface SimConfig {
  circleName: string;
  contributionAmountKobo: number;
  maxSlots: number;
  frequency: 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';
  payoutLogic: 'SEQUENTIAL' | 'RANDOM_DRAW' | 'TRUST_SCORE' | 'COMBINED' | 'ADMIN_ASSIGNED';
  members: MemberConfig[];
  cycles: CycleConfig[];
  peerReviews?: PeerReviewConfig[];
}

// ── Table types ───────────────────────────────────────────────────────────────

interface ScoreRow {
  cycle: string;
  event: string;
  scores: Map<string, { raw: number; display: number }>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const RUN_ID = `sim_${Date.now()}`;
const WALLET_FUND_AMOUNT = 5_000_000n; // ₦50,000 — generous buffer
const NO_CLEANUP = process.argv.includes('--no-cleanup');

// ── No-op notifications ──────────────────────────────────────────────────────

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
  return Test.createTestingModule({
    providers: [
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
      { provide: getQueueToken(AUTH_EVENTS_QUEUE), useValue: { add: async () => ({}) } },
      { provide: NotificationService, useValue: noopNotifications() },
    ],
  }).compile();
}

// ── Helper: Fund wallet ───────────────────────────────────────────────────────

async function fundWallet(ledger: LedgerService, walletId: string, amount: bigint, userId: string) {
  await ledger.writeEntry({
    walletId,
    entryType: EntryType.CREDIT,
    movementType: MovementType.FUNDING,
    amount,
    reference: `SIM-FUND-${crypto.randomUUID()}`,
    sourceType: LedgerSourceType.TRANSACTION,
    sourceId: `sim-fund-${userId}-${Date.now()}`,
    metadata: { note: 'manual simulation funding' },
  });
}

// ── Helper: Set schedule timing mode ─────────────────────────────────────────

async function setScheduleMode(
  prisma: PrismaService,
  circleId: string,
  cycleNumber: number,
  mode: 'on_time' | 'late',
) {
  const now = new Date();
  const contributionDeadline =
    mode === 'on_time'
      ? new Date(now.getTime() + 60 * 60 * 1000)   // +1 hour
      : new Date(now.getTime() - 30 * 60 * 1000);   // -30 minutes
  const payoutDate = new Date(now.getTime() + 25 * 60 * 60 * 1000); // always +25h

  await prisma.roscaCycleSchedule.updateMany({
    where: { circleId, cycleNumber, obsoletedAt: null },
    data: { contributionDeadline, payoutDate },
  });
}

// ── Helper: Read score ────────────────────────────────────────────────────────

async function readScore(
  prisma: PrismaService,
  userId: string,
): Promise<{ raw: number; display: number }> {
  const stats = await prisma.userTrustStats.findUnique({ where: { userId } });
  const raw = stats?.trustScore ?? 50;
  return { raw, display: Math.round(300 + raw * 5.5) };
}

// ── Helper: map config event type → TrustScoreEvent ──────────────────────────

function mapEventType(e: ExtraTrustEvent): TrustScoreEvent {
  switch (e.event) {
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
      if (!e.rating || e.rating < 1 || e.rating > 5) {
        throw new Error(`peer_rating requires rating 1–5 (got ${e.rating}) for member ${e.member}`);
      }
      return { type: 'peer_rating', rating: e.rating };
    case 'cycle_reset':
      return { type: 'cycle_reset' };
    default:
      throw new Error(`Unknown extra trust event type: ${e.event}`);
  }
}

// ── Print score table ─────────────────────────────────────────────────────────

function printScoreTable(rows: ScoreRow[], memberLabels: string[]) {
  const COL = 20;
  const header =
    'Cycle'.padEnd(8) +
    'Event'.padEnd(38) +
    memberLabels.map((l) => l.padEnd(COL)).join('');
  const sep = '─'.repeat(header.length);

  console.log(`\n${sep}`);
  console.log(header);
  console.log(sep);

  for (const row of rows) {
    const scoreStr = memberLabels
      .map((label) => {
        const s = row.scores.get(label);
        if (!s) return '—'.padEnd(COL);
        return `${s.raw} (${s.display})`.padEnd(COL);
      })
      .join('');
    console.log(row.cycle.padEnd(8) + row.event.padEnd(38) + scoreStr);
  }

  console.log(sep);
  console.log('Scores shown as: raw (display)  |  raw: 0–100 internal  |  display: 300–850');
  console.log(sep + '\n');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanupSimRecords(prisma: SimPrismaService, runId: string, circleId: string) {
  // ROSCA business records (child-first order)
  await prisma.peerReview.deleteMany({ where: { circleId } });
  await prisma.roscaPayout.deleteMany({ where: { circleId } });
  await prisma.roscaContribution.deleteMany({ where: { circleId } });
  await prisma.roscaCycleSchedule.deleteMany({ where: { circleId } });
  await prisma.loan.deleteMany({ where: { circleId } });
  await prisma.roscaInvite.deleteMany({ where: { circleId } });
  await prisma.missedContributionDebt.deleteMany({ where: { circleId } });
  await prisma.roscaMembership.deleteMany({ where: { circleId } });
  await prisma.roscaCircle.deleteMany({ where: { id: circleId } });
  await prisma.auditLog.deleteMany({ where: { actorId: 'SYSTEM', entityId: circleId } });

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

  // prisma.ledgerEntry → redirected to sim_ledger_entries (real ledger stays clean)
  // prisma.walletBucket → redirected to sim_wallet_buckets
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.walletBucket.deleteMany({ where: { walletId: { in: walletIds } } });

  // Now real wallet/user can be deleted
  await prisma.auditLog.deleteMany({ where: { actorId: { in: simUserIds } } });
  await prisma.creditScore.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.userTrustStats.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: simUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: simUserIds } } });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Load config
  const configPath =
    process.argv.find((a) => !a.startsWith('-') && a.endsWith('.json')) ??
    path.join(__dirname, 'simulate-manual-config.json');

  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config: SimConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Validate
  const totalCycles = config.members.length;
  if (config.cycles.some((c) => c.cycleNumber < 1 || c.cycleNumber > totalCycles)) {
    console.error(`cycleNumber must be between 1 and ${totalCycles} (number of members)`);
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ROSCA Manual Simulation  [Run ID: ${RUN_ID}]`);
  console.log('═'.repeat(80));
  console.log(`  Config : ${path.resolve(configPath)}`);
  console.log(`  Circle : "${config.circleName}"`);
  console.log(`  Members: ${config.members.map((m) => m.label).join(', ')}`);
  console.log(`  Cycles : ${config.cycles.length}`);
  console.log(`  Amount : ${config.contributionAmountKobo.toLocaleString()} kobo (₦${(config.contributionAmountKobo / 100).toLocaleString()})`);
  console.log('═'.repeat(80) + '\n');

  const moduleRef = await bootstrap();
  const prisma = moduleRef.get(SimPrismaService);
  const ledger = moduleRef.get(LedgerService);
  const trustService = moduleRef.get(TrustService);
  const contributionService = moduleRef.get(ContributionService);
  const payoutService = moduleRef.get(PayoutService);
  const membershipService = moduleRef.get(MembershipService);
  const circleService = moduleRef.get(CircleService);
  const peerReviewService = moduleRef.get(PeerReviewService);

  const contributionAmount = BigInt(config.contributionAmountKobo);
  const memberLabels = config.members.map((m) => m.label);
  const scoreRows: ScoreRow[] = [];
  let circleId = '';

  try {
    // ── 1. Create admin user ─────────────────────────────────────────────────
    const adminId = crypto.randomUUID();
    const adminEmail = `${RUN_ID}_admin@sim.test`;
    await prisma.user.create({
      data: {
        id: adminId,
        email: adminEmail,
        firstName: 'Sim',
        lastName: 'Admin',
        password: 'SIM_LOCKED',
        gender: Gender.MALE,
        phone: `+234${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`,
        role: Role.ADMIN,
        isVerified: true,
        dob: new Date('1990-01-01'),
      },
    });
    const adminWallet = await prisma.wallet.create({ data: { userId: adminId } });
    await fundWallet(ledger, adminWallet.id, WALLET_FUND_AMOUNT, adminId);

    // ── 2. Create member users ────────────────────────────────────────────────
    const memberMap = new Map<string, { id: string; walletId: string }>();

    for (const m of config.members) {
      const uid = crypto.randomUUID();
      const email = `${RUN_ID}_${m.label.toLowerCase()}@sim.test`;
      await prisma.user.create({
        data: {
          id: uid,
          email,
          firstName: 'Sim',
          lastName: m.label,
          password: 'SIM_LOCKED',
          gender: Gender.MALE,
          phone: `+234${Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000}`,
          role: Role.MEMBER,
          isVerified: true,
          dob: new Date('1990-01-01'),
        },
      });

      const wallet = await prisma.wallet.create({ data: { userId: uid } });
      await prisma.userTrustStats.upsert({
        where: { userId: uid },
        update: {},
        create: { userId: uid, trustScore: 50 },
      });
      await fundWallet(ledger, wallet.id, WALLET_FUND_AMOUNT, uid);
      memberMap.set(m.label, { id: uid, walletId: wallet.id });
    }

    // ── 3. Create and activate circle ────────────────────────────────────────
    console.log(`[Setup] Creating circle "${config.circleName}"...`);
    const circleRecord = await circleService.createCircle(adminId, {
      name: `${RUN_ID} ${config.circleName}`,
      contributionAmount: contributionAmount.toString(),
      maxSlots: config.maxSlots,
      durationCycles: config.members.length, // overwritten to actual count on activation
      frequency: config.frequency,
      payoutLogic: PayoutLogic[config.payoutLogic],
      visibility: 'PUBLIC',
    });
    circleId = circleRecord.id;

    // Members join, admin approves
    for (const m of config.members) {
      const { id: userId } = memberMap.get(m.label)!;
      await membershipService.requestToJoin(userId, circleId);
      await membershipService.approveMember(circleId, adminId, userId);
    }

    // Assign ADMIN_ASSIGNED positions if applicable
    if (config.payoutLogic === 'ADMIN_ASSIGNED') {
      await circleService.updatePayoutConfiguration(circleId, adminId, {
        payoutLogic: PayoutLogic.ADMIN_ASSIGNED,
        assignments: config.members.map((m) => ({
          userId: memberMap.get(m.label)!.id,
          position: m.payoutPosition,
        })),
      });
    }

    const initialDeadline = new Date(Date.now() + 30 * 60 * 1000);
    await circleService.activateCircle(circleId, initialDeadline);
    console.log(`[Setup] Circle activated. Running ${config.cycles.length} cycles...\n`);

    // ── 4. Capture initial scores ─────────────────────────────────────────────
    const initialScores = new Map<string, { raw: number; display: number }>();
    for (const m of config.members) {
      const { id } = memberMap.get(m.label)!;
      initialScores.set(m.label, await readScore(prisma, id));
    }
    scoreRows.push({ cycle: '—', event: 'Before circle starts (baseline)', scores: new Map(initialScores) });

    // ── 5. Run cycles ─────────────────────────────────────────────────────────
    for (const cycleConfig of config.cycles) {
      const { cycleNumber, contributions: contribs, extraTrustEvents = [] } = cycleConfig;

      console.log(`[Cycle ${cycleNumber}] Processing contributions...`);

      // Separate on-time from late contributors
      const onTimers = contribs.filter((c) => c.timing === 'on_time');
      const lateOnes = contribs.filter((c) => c.timing === 'late');
      const missed   = contribs.filter((c) => c.timing === 'missed');

      // Step 1: Set deadline in future, process on-time contributors
      if (onTimers.length > 0) {
        await setScheduleMode(prisma, circleId, cycleNumber, 'on_time');
        for (const c of onTimers) {
          const { id: userId } = memberMap.get(c.member)!;
          await contributionService.makeContribution(userId, circleId, cycleNumber);
          console.log(`  ✓ ${c.member} contributed on-time`);
        }
      }

      // Step 2: Flip deadline to past, process late contributors
      if (lateOnes.length > 0) {
        await setScheduleMode(prisma, circleId, cycleNumber, 'late');
        for (const c of lateOnes) {
          const { id: userId } = memberMap.get(c.member)!;
          await contributionService.makeContribution(userId, circleId, cycleNumber);
          console.log(`  ⚠ ${c.member} contributed LATE (penalty applied)`);
        }
      }

      // Log missed members (they'll be caught by processPayout → recordMissedContributions)
      for (const c of missed) {
        console.log(`  ✗ ${c.member} MISSED (will be recorded by payout processor)`);
      }

      // Capture pre-payout scores
      const prePayoutScores = new Map<string, { raw: number; display: number }>();
      for (const m of config.members) {
        prePayoutScores.set(m.label, await readScore(prisma, memberMap.get(m.label)!.id));
      }
      scoreRows.push({
        cycle: `C${cycleNumber}`,
        event: 'After contributions',
        scores: new Map(prePayoutScores),
      });

      // Step 3: Process payout (also fires missed_payment for non-contributors)
      console.log(`[Cycle ${cycleNumber}] Processing payout...`);
      const result = await payoutService.processPayout(circleId, cycleNumber);
      console.log(`  → Payout processed. Recipient: ${result.recipientId}  Amount: ${result.amount} kobo`);
      if (result.isLastCycle) console.log('  → Last cycle — circle COMPLETED, collateral released.');

      // Capture post-payout scores
      const postPayoutScores = new Map<string, { raw: number; display: number }>();
      for (const m of config.members) {
        postPayoutScores.set(m.label, await readScore(prisma, memberMap.get(m.label)!.id));
      }
      scoreRows.push({
        cycle: `C${cycleNumber}`,
        event: 'After payout (missed_payment recorded)',
        scores: new Map(postPayoutScores),
      });

      // Step 4: Apply extra trust events specified in the config
      if (extraTrustEvents.length > 0) {
        console.log(`[Cycle ${cycleNumber}] Applying ${extraTrustEvents.length} extra trust event(s)...`);
        for (const ev of extraTrustEvents) {
          const { id: userId } = memberMap.get(ev.member)!;
          const trustEvent = mapEventType(ev);
          await trustService.fireTrustEventAdmin(userId, trustEvent);
          if (ev.note) console.log(`  → ${ev.member}: ${ev.event}  (${ev.note})`);
          else console.log(`  → ${ev.member}: ${ev.event}`);
        }

        const postEventScores = new Map<string, { raw: number; display: number }>();
        for (const m of config.members) {
          postEventScores.set(m.label, await readScore(prisma, memberMap.get(m.label)!.id));
        }
        scoreRows.push({
          cycle: `C${cycleNumber}`,
          event: 'After extra trust events',
          scores: new Map(postEventScores),
        });
      }

      console.log();
    }

    // ── 6. Peer reviews ───────────────────────────────────────────────────────
    if (config.peerReviews && config.peerReviews.length > 0) {
      console.log(`[Peer Reviews] Submitting ${config.peerReviews.length} review(s)...`);
      for (const r of config.peerReviews) {
        const reviewerId = memberMap.get(r.reviewer)?.id;
        const revieweeId = memberMap.get(r.reviewee)?.id;
        if (!reviewerId || !revieweeId) {
          console.warn(`  ⚠ Skipping review ${r.reviewer}→${r.reviewee}: member not found`);
          continue;
        }
        await peerReviewService.submitReview(circleId, reviewerId, {
          revieweeId,
          rating: r.rating,
          comment: r.comment,
        });
        console.log(`  ✓ ${r.reviewer} → ${r.reviewee}: ${r.rating}/5`);
      }

      const postReviewScores = new Map<string, { raw: number; display: number }>();
      for (const m of config.members) {
        postReviewScores.set(m.label, await readScore(prisma, memberMap.get(m.label)!.id));
      }
      scoreRows.push({
        cycle: 'Final',
        event: 'After peer reviews',
        scores: new Map(postReviewScores),
      });
    }

    // ── 7. Print score evolution table ────────────────────────────────────────
    printScoreTable(scoreRows, memberLabels);

    // ── 8. Print per-member summary ───────────────────────────────────────────
    console.log('PER-MEMBER FINAL TRUST DETAILS');
    console.log('─'.repeat(80));
    for (const m of config.members) {
      const { id } = memberMap.get(m.label)!;
      const stats = await prisma.userTrustStats.findUnique({ where: { userId: id } });
      if (!stats) continue;
      const display = Math.round(300 + stats.trustScore * 5.5);
      console.log(
        `  ${m.label.padEnd(10)}` +
          `score=${stats.trustScore} (${display})  ` +
          `onTime=${stats.totalOnTimePayments}  ` +
          `late=${stats.totalLatePayments}  ` +
          `missed=${stats.totalMissedPayments}  ` +
          `defaults=${stats.totalDefaults}  ` +
          `peerRatings=${stats.totalPeerRatings} (avg=${stats.averagePeerRating.toFixed(2)})`,
      );
    }
    console.log('─'.repeat(80) + '\n');

  } finally {
    if (!NO_CLEANUP && circleId) {
      console.log(`[Cleanup] Removing simulation records (run ID: ${RUN_ID})...`);
      await cleanupSimRecords(prisma, RUN_ID, circleId);
      console.log('[Cleanup] Done.\n');
    } else if (NO_CLEANUP) {
      console.log(`[Cleanup] Skipped. Records are in DB under run ID: ${RUN_ID}\n`);
    }
    await moduleRef.close();
  }
}

main().catch((err) => {
  console.error('\n[FATAL] Simulation failed:', err);
  process.exit(1);
});
