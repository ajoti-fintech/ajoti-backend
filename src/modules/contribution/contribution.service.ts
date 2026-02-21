import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { TrustService } from '../trust/trust.service';
import {
  Prisma,
  EntryType,
  MovementType,
  BucketType,
  LedgerSourceType,
  SystemWalletType,
  CircleStatus,
  MembershipStatus,
} from '@prisma/client';
import { ListContributionsQueryDto } from './dto/contribution.dto';

@Injectable()
export class ContributionService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private trustService: TrustService,
  ) {}

  // CONTRIBUTION — INTERNAL TRANSFER ONLY (R8)

  async makeContribution(userId: string, circleId: string, cycleNumber: number) {
    return await this.prisma.$transaction(
      async (tx) => {
        // 1. Get circle and membership with locks
        const circle = await tx.roscaCircle.findUnique({
          where: { id: circleId },
          include: {
            schedules: {
              where: { cycleNumber, obsoletedAt: null },
            },
          },
        });

        const membership = await tx.roscaMembership.findUnique({
          where: {
            circleId_userId: { circleId, userId },
          },
        });

        if (!circle) throw new NotFoundException('Circle not found');
        if (circle.status !== CircleStatus.ACTIVE) {
          throw new BadRequestException('Circle not active');
        }
        if (!membership || membership.status !== MembershipStatus.ACTIVE) {
          throw new BadRequestException('Not an active member');
        }

        // 2. Pre-generate Contribution ID
        const contributionId = crypto.randomUUID();

        // 3. Penalty Logic
        const schedule = circle.schedules[0];
        const isLate = new Date() > schedule.contributionDeadline;
        const penalty = isLate
          ? (circle.contributionAmount * BigInt(Math.round(circle.latePenaltyPercent * 100))) /
            10000n
          : 0n;

        // 4. System Wallets
        const systemWallet = await tx.systemWallet.findUnique({
          where: { type: SystemWalletType.PLATFORM_POOL },
        });
        const userWallet = await tx.wallet.findUnique({ where: { userId } });

        // 5. Ledger Movements (Internal Transfer R1/R8)
        // Participant DEBIT -> Pool CREDIT
        const debitRef = `CONTRIB-${crypto.randomUUID()}`;
        const debitEntry = await this.ledger.writeEntry(
          {
            walletId: userWallet!.id,
            entryType: EntryType.DEBIT,
            movementType: MovementType.TRANSFER,
            bucketType: BucketType.ROSCA,
            amount: circle.contributionAmount,
            reference: debitRef,
            sourceType: LedgerSourceType.CONTRIBUTION,
            sourceId: contributionId, // Passed immediately
            metadata: { circleId, cycleNumber },
          },
          tx,
        );

        // Platform pool credit
        await this.ledger.writeEntry(
          {
            walletId: systemWallet!.walletId,
            entryType: EntryType.CREDIT,
            movementType: MovementType.TRANSFER,
            bucketType: BucketType.ROSCA,
            amount: circle.contributionAmount,
            reference: `POOL-CRED-${crypto.randomUUID()}`,
            sourceType: LedgerSourceType.CONTRIBUTION,
            sourceId: contributionId,
            metadata: { fromUserId: userId },
          },
          tx,
        );

        // 6. Penalty Ledger Entries (If applicable)
        if (penalty > 0) {
          const pRef = `PEN-${crypto.randomUUID()}`;
          await this.ledger.writeEntry(
            {
              walletId: userWallet!.id,
              entryType: EntryType.DEBIT,
              movementType: MovementType.TRANSFER,
              amount: penalty,
              reference: pRef,
              sourceType: LedgerSourceType.PENALTY,
              sourceId: contributionId,
            },
            tx,
          );

          await this.ledger.writeEntry(
            {
              walletId: systemWallet!.walletId,
              entryType: EntryType.CREDIT,
              movementType: MovementType.TRANSFER,
              amount: penalty,
              reference: `POOL-PEN-${crypto.randomUUID()}`,
              sourceType: LedgerSourceType.PENALTY,
              sourceId: contributionId,
            },
            tx,
          );
        }

        // 7. Record Contribution
        const contribution = await tx.roscaContribution.create({
          data: {
            id: contributionId,
            circleId,
            membershipId: membership.id,
            userId,
            cycleNumber,
            amount: circle.contributionAmount,
            penaltyAmount: penalty,
            ledgerDebitId: debitEntry.id,
            transactionReference: debitRef,
          },
        });

        // 8. Update State
        await tx.roscaMembership.update({
          where: { id: membership.id },
          data: {
            completedCycles: { increment: 1 },
            totalLatePayments: isLate ? { increment: 1 } : undefined,
            totalPenaltiesPaid: penalty > 0 ? { increment: penalty } : undefined,
          },
        });

        await this.trustService.updateTrustScore(userId, { onTime: !isLate }, tx);

        return contribution;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  // CONTRIBUTION RETRIEVAL
  
  /**
   * Get contribution history for a specific user in a circle
   */
  // src/modules/contribution/contribution.service.ts

  async getContributions(
    circleId: string,
    userId: string,
    query: ListContributionsQueryDto = {}, // Default to empty object
  ) {
    const { cycleNumber, limit, offset } = query;

    return await this.prisma.roscaContribution.findMany({
      where: {
        circleId,
        userId,
        cycleNumber: cycleNumber, // Filters by cycle if provided
      },
      take: limit,
      skip: offset,
      orderBy: { cycleNumber: 'desc' },
    });
  }
}
