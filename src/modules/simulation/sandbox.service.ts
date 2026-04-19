// src/modules/simulation/sandbox.service.ts
/**
 * SandboxService
 *
 * Provides persistent simulation endpoints for testing the full app against
 * the simulation database (SIM_NEON_DB_URL). Unlike SimulationService, data
 * is NOT cleaned up after each operation — it stays in the sim DB so callers
 * can:
 *   - Hit real read endpoints (wallet balance, ledger history, payout history)
 *   - Verify ledger reconciliation across a full circle lifecycle
 *   - Inspect trust scores, credit scores, membership states at any point
 *
 * All sim records are namespaced by runId (format: sim_<timestamp>) for easy
 * isolation and cleanup via the reset endpoint.
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  EntryType,
  MovementType,
  LedgerSourceType,
  Gender,
  Role,
  PayoutLogic,
} from '@prisma/client';

import { SimPrismaService } from './sim-prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { CircleService } from '../rosca/services/circle.service';
import { MembershipService } from '../rosca/services/membership.service';
import { ContributionService } from '../contribution/contribution.service';
import { PayoutService } from '../payout/payout.service';
import { LoanService } from '../loans/loans.service';
import { TrustService } from '../trust/trust.service';

import {
  CreateSandboxUsersDto,
  CreateSandboxCircleDto,
  RunSandboxCycleDto,
  ApplySandboxLoanDto,
  SandboxUser,
  SandboxUsersResult,
  SandboxCircleResult,
  SandboxCycleResult,
  SandboxCycleMemberResult,
  LedgerInspectResult,
  LedgerEntryRow,
  ReconcileRunResult,
  WalletReconcileRow,
} from './dto/sandbox.dto';

const DEFAULT_FUND_AMOUNT = 5_000_000n; // ₦50,000 in kobo

@Injectable()
export class SandboxService {
  constructor(
    private readonly prisma: SimPrismaService,
    private readonly ledger: LedgerService,
    private readonly circleService: CircleService,
    private readonly membershipService: MembershipService,
    private readonly contributionService: ContributionService,
    private readonly payoutService: PayoutService,
    private readonly loanService: LoanService,
    private readonly trustService: TrustService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // USERS — create sim users and fund their wallets
  // ═══════════════════════════════════════════════════════════════════════════

  async createUsers(dto: CreateSandboxUsersDto): Promise<SandboxUsersResult> {
    const runId = dto.runId ?? `sim_${Date.now()}`;
    const fundAmount = dto.fundAmountKobo ? BigInt(dto.fundAmountKobo) : DEFAULT_FUND_AMOUNT;

    const users: SandboxUser[] = [];

    for (let i = 1; i <= dto.count; i++) {
      const user = await this.createSimUser(runId, `M${i}`, Role.MEMBER, fundAmount);
      users.push({ ...user, role: 'MEMBER' });
    }

    return { runId, users };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CIRCLE — create + activate a circle with existing sim users
  // ═══════════════════════════════════════════════════════════════════════════

  async createCircle(dto: CreateSandboxCircleDto): Promise<SandboxCircleResult> {
    // Validate all member IDs exist in the sim DB
    const members = await this.prisma.user.findMany({
      where: { id: { in: dto.memberIds } },
      select: { id: true },
    });
    if (members.length !== dto.memberIds.length) {
      throw new BadRequestException(
        'One or more memberIds not found in the simulation database',
      );
    }

    // Use provided admin or create one
    let adminId = dto.adminId;
    if (!adminId) {
      const admin = await this.createSimUser(dto.runId, 'Admin', Role.ADMIN, DEFAULT_FUND_AMOUNT);
      adminId = admin.id;
    } else {
      const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
      if (!admin) throw new NotFoundException('adminId not found in the simulation database');
    }

    // Create circle
    const circle = await this.circleService.createCircle(adminId, {
      name: `${dto.runId}_${dto.name}`,
      contributionAmount: dto.contributionAmountKobo.toString(),
      maxSlots: dto.memberIds.length,
      durationCycles: dto.memberIds.length,
      frequency: dto.frequency,
      payoutLogic: dto.payoutLogic as PayoutLogic,
      visibility: 'PUBLIC',
    });

    // Add all members
    for (const memberId of dto.memberIds) {
      await this.membershipService.requestToJoin(memberId, circle.id);
      await this.membershipService.approveMember(circle.id, adminId, memberId);
    }

    // Apply ADMIN_ASSIGNED payout order if provided
    if (dto.payoutLogic === 'ADMIN_ASSIGNED' && dto.assignments?.length) {
      await this.circleService.updatePayoutConfiguration(circle.id, adminId, {
        payoutLogic: PayoutLogic.ADMIN_ASSIGNED,
        assignments: dto.assignments,
      });
    }

    // Activate (start date = 30 min from now so the first deadline check passes)
    await this.circleService.activateCircle(circle.id, new Date(Date.now() + 30 * 60 * 1000));

    return {
      runId: dto.runId,
      circleId: circle.id,
      adminId,
      memberIds: dto.memberIds,
      durationCycles: dto.memberIds.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CYCLE — process one cycle (contributions + payout), data persists
  // ═══════════════════════════════════════════════════════════════════════════

  async runCycle(dto: RunSandboxCycleDto): Promise<SandboxCycleResult> {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: dto.circleId },
    });
    if (!circle) throw new NotFoundException('Circle not found in simulation database');

    const onTimers = dto.contributions.filter((c) => c.timing === 'on_time').map((c) => c.userId);
    const lateOnes = dto.contributions.filter((c) => c.timing === 'late').map((c) => c.userId);
    // 'skip' entries are intentionally omitted — payout will detect them as missed

    // On-time contributions (deadline in future)
    if (onTimers.length > 0) {
      await this.setScheduleMode(dto.circleId, dto.cycleNumber, 'on_time');
      for (const userId of onTimers) {
        await this.contributionService.makeContribution(userId, dto.circleId, dto.cycleNumber);
      }
    }

    // Late contributions (deadline in past, incurs penalty)
    if (lateOnes.length > 0) {
      await this.setScheduleMode(dto.circleId, dto.cycleNumber, 'late');
      for (const userId of lateOnes) {
        await this.contributionService.makeContribution(userId, dto.circleId, dto.cycleNumber);
      }
    }

    // Reset deadline to future so payout validation passes
    await this.setScheduleMode(dto.circleId, dto.cycleNumber, 'on_time');

    // Process payout — recordMissedContributions fires automatically for skipped members
    const payoutResult = await this.payoutService.processPayout(dto.circleId, dto.cycleNumber);

    // Snapshot trust scores for all contributors + skipped members
    const allUserIds = dto.contributions.map((c) => c.userId);
    const memberResults: SandboxCycleMemberResult[] = [];

    for (const entry of dto.contributions) {
      const stats = await this.prisma.userTrustStats.findUnique({
        where: { userId: entry.userId },
      });
      const raw = stats?.trustScore ?? 50;
      memberResults.push({
        userId: entry.userId,
        contributed: entry.timing !== 'skip',
        timing: entry.timing,
        trustScore: { raw, display: Math.round(300 + raw * 5.5) },
      });
    }

    return {
      circleId: dto.circleId,
      cycleNumber: dto.cycleNumber,
      members: memberResults,
      payout: {
        payoutId: payoutResult.payoutId,
        recipientId: payoutResult.recipientId,
        amount: payoutResult.amount,
        isLastCycle: payoutResult.isLastCycle,
        status: payoutResult.status,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAN — apply a loan for a sim user before their payout cycle
  // ═══════════════════════════════════════════════════════════════════════════

  async applyLoan(dto: ApplySandboxLoanDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('User not found in simulation database');

    const circle = await this.prisma.roscaCircle.findUnique({ where: { id: dto.circleId } });
    if (!circle) throw new NotFoundException('Circle not found in simulation database');

    return this.loanService.applyLoan(dto.userId, dto.circleId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEDGER — inspect entries + verify running-total invariant for one wallet
  // ═══════════════════════════════════════════════════════════════════════════

  async inspectLedger(walletId: string): Promise<LedgerInspectResult> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException('Wallet not found in simulation database');

    const rawEntries = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: 'asc' },
    });

    // Recompute running balance and verify each row's balanceAfter
    let runningBalance = 0n;
    const entries: LedgerEntryRow[] = rawEntries.map((e) => {
      if (e.entryType === 'CREDIT') runningBalance += e.amount;
      else if (e.entryType === 'DEBIT') runningBalance -= e.amount;
      // RESERVE/RELEASE don't change the total balance

      return {
        id: e.id,
        entryType: e.entryType,
        movementType: e.movementType,
        bucketType: e.bucketType ?? 'MAIN',
        amount: e.amount.toString(),
        balanceBefore: e.balanceBefore.toString(),
        balanceAfter: e.balanceAfter.toString(),
        reference: e.reference,
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        createdAt: e.createdAt.toISOString(),
      };
    });

    const lastEntry = rawEntries.at(-1);
    const reportedBalance = lastEntry?.balanceAfter ?? 0n;
    const discrepancy = runningBalance - reportedBalance;

    return {
      walletId,
      entryCount: rawEntries.length,
      reportedBalance: reportedBalance.toString(),
      computedBalance: runningBalance.toString(),
      isReconciled: discrepancy === 0n,
      discrepancy: discrepancy.toString(),
      entries,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RECONCILE — verify every wallet belonging to a runId
  // ═══════════════════════════════════════════════════════════════════════════

  async reconcileRun(runId: string): Promise<ReconcileRunResult> {
    const simUsers = await this.prisma.user.findMany({
      where: { email: { startsWith: runId } },
      select: { id: true },
    });

    if (simUsers.length === 0) {
      throw new NotFoundException(`No sim users found for runId "${runId}"`);
    }

    const wallets = await this.prisma.wallet.findMany({
      where: { userId: { in: simUsers.map((u) => u.id) } },
      select: { id: true, userId: true },
    });

    const rows: WalletReconcileRow[] = [];

    for (const wallet of wallets) {
      const entries = await this.prisma.ledgerEntry.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'asc' },
      });

      let computed = 0n;
      for (const e of entries) {
        if (e.entryType === 'CREDIT') computed += e.amount;
        else if (e.entryType === 'DEBIT') computed -= e.amount;
      }

      const reported = entries.at(-1)?.balanceAfter ?? 0n;
      const discrepancy = computed - reported;

      rows.push({
        walletId: wallet.id,
        userId: wallet.userId,
        isReconciled: discrepancy === 0n,
        reportedBalance: reported.toString(),
        computedBalance: computed.toString(),
        discrepancy: discrepancy.toString(),
        entryCount: entries.length,
      });
    }

    // Also include the system wallets that were involved (PLATFORM_POOL)
    const systemWallets = await this.prisma.systemWallet.findMany({
      select: { walletId: true, type: true },
    });

    for (const sw of systemWallets) {
      const entries = await this.prisma.ledgerEntry.findMany({
        where: { walletId: sw.walletId },
        orderBy: { createdAt: 'asc' },
      });

      if (entries.length === 0) continue;

      let computed = 0n;
      for (const e of entries) {
        if (e.entryType === 'CREDIT') computed += e.amount;
        else if (e.entryType === 'DEBIT') computed -= e.amount;
      }

      const reported = entries.at(-1)?.balanceAfter ?? 0n;
      const discrepancy = computed - reported;

      rows.push({
        walletId: sw.walletId,
        userId: `SYSTEM:${sw.type}`,
        isReconciled: discrepancy === 0n,
        reportedBalance: reported.toString(),
        computedBalance: computed.toString(),
        discrepancy: discrepancy.toString(),
        entryCount: entries.length,
      });
    }

    return {
      runId,
      allReconciled: rows.every((r) => r.isReconciled),
      wallets: rows,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESET — clean up all records for a runId
  // ═══════════════════════════════════════════════════════════════════════════

  async resetRun(runId: string): Promise<{ deleted: number }> {
    const simUsers = await this.prisma.user.findMany({
      where: { email: { startsWith: runId } },
      select: { id: true },
    });

    if (simUsers.length === 0) {
      throw new NotFoundException(`No sim users found for runId "${runId}"`);
    }

    const userIds = simUsers.map((u) => u.id);

    const wallets = await this.prisma.wallet.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    const walletIds = wallets.map((w) => w.id);

    // Find circles owned by sim users
    const circles = await this.prisma.roscaCircle.findMany({
      where: { adminId: { in: userIds } },
      select: { id: true },
    });
    const circleIds = circles.map((c) => c.id);

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
      await this.prisma.auditLog.deleteMany({
        where: { actorId: 'SYSTEM', entityId: { in: circleIds } },
      });
    }

    await this.prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await this.prisma.creditScore.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.userTrustStats.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
    await this.prisma.walletBucket.deleteMany({ where: { walletId: { in: walletIds } } });
    await this.prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await this.prisma.user.deleteMany({ where: { id: { in: userIds } } });

    return { deleted: userIds.length };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async createSimUser(
    runId: string,
    label: string,
    role: Role,
    fundAmount: bigint,
  ): Promise<{ id: string; label: string; email: string; walletId: string }> {
    const id = crypto.randomUUID();
    const email = `${runId}_${label.toLowerCase()}@sim.test`;

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

    await this.ledger.writeEntry({
      walletId: wallet.id,
      entryType: EntryType.CREDIT,
      movementType: MovementType.FUNDING,
      amount: fundAmount,
      reference: `SIM-FUND-${crypto.randomUUID()}`,
      sourceType: LedgerSourceType.TRANSACTION,
      sourceId: `sim-fund-${id}-${Date.now()}`,
      metadata: { note: 'sandbox funding' },
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
        ? new Date(now.getTime() + 60 * 60 * 1000)  // +1 hour
        : new Date(now.getTime() - 30 * 60 * 1000); // -30 minutes
    const payoutDate = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    await this.prisma.roscaCycleSchedule.updateMany({
      where: { circleId, cycleNumber, obsoletedAt: null },
      data: { contributionDeadline, payoutDate },
    });
  }
}
