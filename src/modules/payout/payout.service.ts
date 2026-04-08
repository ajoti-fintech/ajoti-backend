// src/modules/payout/payout.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  Prisma,
  EntryType,
  MovementType,
  BucketType,
  LedgerSourceType,
  SystemWalletType,
  CircleStatus,
  ScheduleStatus,
  PayoutStatus,
  MembershipStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma';
import { LedgerService } from '../ledger/ledger.service';
import { PayoutResult } from './interfaces/payout.interface';
import { ReversePayoutDto } from './dto/payout.dto';

/**
 * BUCKET TYPE RULES (from LedgerService):
 *
 *   CREDIT / DEBIT  → must use BucketType.MAIN (or omit bucketType)
 *   RESERVE / RELEASE → must use a non-MAIN bucket (e.g. BucketType.ROSCA)
 *
 * Payouts move money between wallets via DEBIT (pool) + CREDIT (recipient).
 * Both of those are MAIN bucket operations — the ROSCA reservation was already
 * released by each member's RELEASE entry when they contributed.
 */
@Injectable()
export class PayoutService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) { }

  /**
   * PROCESS PAYOUT — Rules R1, R5, R7, R10
   * Moves total pot from Platform Pool wallet to winner's wallet.
   *
   * Ledger entries written:
   *   1. DEBIT  (MAIN) on system pool wallet  — pot leaves the pool
   *   2. CREDIT (MAIN) on recipient wallet    — pot arrives for winner
   */
  async processPayout(circleId: string, cycleNumber: number): Promise<PayoutResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // ── 1. Fetch & validate circle + schedule ──────────────────────────
        const circle = await tx.roscaCircle.findUnique({
          where: { id: circleId },
          include: {
            schedules: {
              where: { cycleNumber, obsoletedAt: null },
            },
          },
        });

        if (!circle) throw new NotFoundException('Circle not found');
        if (circle.status !== CircleStatus.ACTIVE) {
          throw new BadRequestException('Circle is not active');
        }

        const schedule = circle.schedules[0];
        if (!schedule) throw new NotFoundException(`No schedule found for cycle ${cycleNumber}`);

        const recipientId = schedule.recipientId;
        if (!recipientId) {
          throw new BadRequestException('No recipient assigned to this cycle');
        }

        // ── 2. Prevent duplicate payout ────────────────────────────────────
        const existing = await tx.roscaPayout.findFirst({
          where: {
            scheduleId: schedule.id,
            status: { in: [PayoutStatus.COMPLETED, PayoutStatus.PROCESSING] },
          },
        });

        if (existing) {
          throw new BadRequestException(
            'Payout already processed or in progress for this cycle',
          );
        }

        // ── 3. Calculate pot ───────────────────────────────────────────────
        const contributions = await tx.roscaContribution.findMany({
          where: { circleId, cycleNumber },
        });

        const totalPot = contributions.reduce(
          (sum, c) => sum + c.amount + c.penaltyAmount,
          BigInt(0),
        );

        if (totalPot === BigInt(0)) {
          throw new BadRequestException('No funds available for payout');
        }

        // ── 4. Resolve wallets ─────────────────────────────────────────────
        const systemWallet = await tx.systemWallet.findUnique({
          where: { type: SystemWalletType.PLATFORM_POOL },
        });
        if (!systemWallet) throw new Error('Platform pool wallet not configured');

        const winnerWallet = await tx.wallet.findUnique({
          where: { userId: recipientId },
        });
        if (!winnerWallet) throw new NotFoundException('Recipient wallet not found');

        const payoutId = crypto.randomUUID();
        const internalRef = `PAYOUT-${crypto.randomUUID()}`;

        // ── 5. Ledger movements ────────────────────────────────────────────
        //
        // DEBIT the pool wallet — BucketType.MAIN (required by LedgerService)
        // The pool holds money as plain MAIN balance; there is no ROSCA bucket on it.
        //
        const poolDebitEntry = await this.ledger.writeEntry(
          {
            walletId: systemWallet.walletId,
            entryType: EntryType.DEBIT,
            movementType: MovementType.TRANSFER,
            bucketType: BucketType.MAIN, // ← MUST be MAIN for DEBIT
            amount: totalPot,
            reference: `POOL-DEBIT-${crypto.randomUUID()}`,
            sourceType: LedgerSourceType.ROSCA_CIRCLE,
            sourceId: payoutId,
            metadata: { circleId, cycleNumber, recipientId },
          },
          tx,
        );

        // CREDIT the recipient wallet — BucketType.MAIN (required by LedgerService)
        // Winner receives into their spendable MAIN balance.
        //
        const recipientCreditEntry = await this.ledger.writeEntry(
          {
            walletId: winnerWallet.id,
            entryType: EntryType.CREDIT,
            movementType: MovementType.TRANSFER,
            bucketType: BucketType.MAIN, // ← MUST be MAIN for CREDIT
            amount: totalPot,
            reference: internalRef,
            sourceType: LedgerSourceType.ROSCA_CIRCLE,
            sourceId: payoutId,
            metadata: { circleId, cycleNumber },
          },
          tx,
        );

        // ── 6. Create payout record ────────────────────────────────────────
        const payout = await tx.roscaPayout.create({
          data: {
            id: payoutId,
            circleId,
            scheduleId: schedule.id,
            recipientId,
            amount: totalPot,
            status: PayoutStatus.COMPLETED,
            internalReference: internalRef,
            poolDebitId: poolDebitEntry.id,
            recipientCreditId: recipientCreditEntry.id,
            processedAt: new Date(),
          },
        });

        // ── 7. Mark schedule completed ─────────────────────────────────────
        await tx.roscaCycleSchedule.update({
          where: { id: schedule.id },
          data: { status: ScheduleStatus.COMPLETED },
        });

        // ── 8. Finalize circle on last cycle ───────────────────────────────
        const isLastCycle = cycleNumber === circle.durationCycles;
        if (isLastCycle) {
          await this.finalizeCircleAndReleaseCollateral(tx, circleId);
        }

        return {
          payoutId: payout.id,
          amount: totalPot.toString(),
          isLastCycle,
          recipientId,
          status: 'COMPLETED',
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * REVERSAL — Compensating entries when external disbursement fails.
   *
   * Undoes the CREDIT on the recipient and restores the DEBIT on the pool.
   * Both reversal entries use BucketType.MAIN — same rule as the originals.
   */
  async reversePayout(dto: ReversePayoutDto): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payout = await tx.roscaPayout.findUnique({
        where: { id: dto.originalPayoutId },
      });

      if (!payout) throw new NotFoundException('Original payout not found');

      if (payout.status === PayoutStatus.FAILED) {
        throw new BadRequestException('Payout already marked as FAILED');
      }

      const systemWallet = await tx.systemWallet.findUnique({
        where: { type: SystemWalletType.PLATFORM_POOL },
      });
      if (!systemWallet) throw new Error('Platform pool wallet not found');

      const recipientWallet = await tx.wallet.findUnique({
        where: { userId: dto.recipientId },
      });
      if (!recipientWallet) throw new NotFoundException('Recipient wallet not found');

      const amountBigInt = BigInt(dto.amount);
      const reversalId = crypto.randomUUID();

      // Undo credit → DEBIT recipient (BucketType.MAIN — recipient's spendable balance)
      const reversalDebit = await this.ledger.writeEntry(
        {
          walletId: recipientWallet.id,
          entryType: EntryType.DEBIT,
          movementType: MovementType.TRANSFER,
          bucketType: BucketType.MAIN, // ← MUST be MAIN for DEBIT
          amount: amountBigInt,
          reference: `REV-DEBIT-${crypto.randomUUID()}`,
          sourceType: LedgerSourceType.REVERSAL,
          sourceId: reversalId,
          metadata: {
            reverses: payout.recipientCreditId,
            reason: dto.reason,
            originalPayoutId: dto.originalPayoutId,
          },
        },
        tx,
      );

      // Undo debit → CREDIT pool (BucketType.MAIN — pool's balance restored)
      const reversalCredit = await this.ledger.writeEntry(
        {
          walletId: systemWallet.walletId,
          entryType: EntryType.CREDIT,
          movementType: MovementType.TRANSFER,
          bucketType: BucketType.MAIN, // ← MUST be MAIN for CREDIT
          amount: amountBigInt,
          reference: `REV-CRED-${crypto.randomUUID()}`,
          sourceType: LedgerSourceType.REVERSAL,
          sourceId: reversalId,
          metadata: {
            reverses: payout.poolDebitId,
            reason: dto.reason,
            originalPayoutId: dto.originalPayoutId,
          },
        },
        tx,
      );

      // Update original payout record
      await tx.roscaPayout.update({
        where: { id: dto.originalPayoutId },
        data: {
          status: PayoutStatus.FAILED,
          failedAt: new Date(),
          reversalDebitId: reversalDebit.id,
          reversalCreditId: reversalCredit.id,
        },
      });

      // Reset schedule so the payout can be retried
      await tx.roscaCycleSchedule.update({
        where: { id: dto.scheduleId },
        data: { status: ScheduleStatus.UPCOMING },
      });

      await tx.auditLog.create({
        data: {
          actorId: 'SYSTEM',
          actorType: 'SYSTEM',
          action: 'PAYOUT_REVERSED',
          entityType: 'ROSCA_PAYOUT',
          entityId: dto.originalPayoutId,
          reason: dto.reason,
          metadata: { amount: dto.amount },
        },
      });
    });
  }

  /**
   * Retry a previously failed payout.
   */
  async retryPayout(originalPayoutId: string): Promise<PayoutResult> {
    const failedPayout = await this.prisma.roscaPayout.findUnique({
      where: { id: originalPayoutId },
      include: { schedule: { select: { cycleNumber: true } } },
    });

    if (!failedPayout) throw new NotFoundException('Failed payout record not found');

    if (failedPayout.status !== PayoutStatus.FAILED) {
      throw new BadRequestException('Only failed payouts can be retried');
    }

    return this.processPayout(failedPayout.circleId, failedPayout.schedule.cycleNumber);
  }

  /**
   * Called on the last cycle to release all member collateral back to MAIN
   * and mark the circle COMPLETED.
   *
   * RELEASE entries correctly use BucketType.ROSCA — LedgerService requires
   * a non-MAIN bucket for RESERVE/RELEASE operations.
   */
  private async finalizeCircleAndReleaseCollateral(
    tx: Prisma.TransactionClient,
    circleId: string,
  ): Promise<void> {
    const memberships = await tx.roscaMembership.findMany({
      where: { circleId, collateralReleased: false },
    });

    for (const member of memberships) {
      const wallet = await tx.wallet.findUnique({
        where: { userId: member.userId },
      });
      if (!wallet) continue;

      // RELEASE — BucketType.ROSCA is correct here (unlocking a ROSCA reservation)
      await this.ledger.writeEntry(
        {
          walletId: wallet.id,
          entryType: EntryType.RELEASE,
          movementType: MovementType.TRANSFER,
          bucketType: BucketType.ROSCA, // ← correct for RELEASE
          amount: member.collateralAmount,
          reference: `COLL-REL-${crypto.randomUUID()}`,
          sourceType: LedgerSourceType.COLLATERAL_RELEASE,
          sourceId: member.id,
          metadata: { circleId, reason: 'CIRCLE_COMPLETED' },
        },
        tx,
      );

      await tx.roscaMembership.update({
        where: { id: member.id },
        data: {
          collateralReleased: true,
          status: MembershipStatus.COMPLETED,
          completedAt: new Date(),
        },
      });
    }

    await tx.roscaCircle.update({
      where: { id: circleId },
      data: { status: CircleStatus.COMPLETED },
    });

    await tx.auditLog.create({
      data: {
        actorId: 'SYSTEM',
        actorType: 'SYSTEM',
        action: 'CIRCLE_COMPLETED',
        entityType: 'ROSCA_CIRCLE',
        entityId: circleId,
        reason: 'All cycles completed',
        metadata: { membersReleased: memberships.length },
      },
    });
  }

  /**
   * Get payout history for a circle.
   */
  async getPayoutHistory(circleId: string) {
    return this.prisma.roscaPayout.findMany({
      where: { circleId },
      include: {
        recipient: {
          select: { firstName: true, lastName: true, email: true },
        },
        schedule: {
          select: { cycleNumber: true, payoutDate: true },
        },
      },
      orderBy: { processedAt: 'desc' },
    });
  }

  /**
   * Find payouts that are due (for cron jobs).
   */
  async findDuePayouts() {
    const now = new Date();

    return this.prisma.roscaCycleSchedule.findMany({
      where: {
        payoutDate: { lte: now },
        status: ScheduleStatus.UPCOMING,
        obsoletedAt: null,
        recipientId: { not: null },
      },
      include: {
        circle: {
          select: { id: true, name: true, status: true },
        },
      },
      orderBy: { payoutDate: 'asc' },
    });
  }

  /**
   * Log payout failure for audit.
   */
  async logPayoutFailure(scheduleId: string, error: Error) {
    await this.prisma.auditLog.create({
      data: {
        actorId: 'SYSTEM',
        actorType: 'SYSTEM',
        action: 'PAYOUT_FAILED',
        entityType: 'ROSCA_CYCLE_SCHEDULE',
        entityId: scheduleId,
        reason: error.message,
        metadata: {
          errorStack: error.stack ?? null,
          timestamp: new Date().toISOString(),
        },
      },
    });
  }
}