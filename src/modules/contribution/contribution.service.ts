import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
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

  /**
   * Make a cycle contribution — internal ledger transfer only (no Flutterwave).
   *
   * The user must have funded their wallet via the funding flow first.
   * Contribution moves money from the user's MAIN balance → Platform Pool MAIN balance.
   * The ROSCA bucket holds only the collateral RESERVE (set at join time) — separate.
   *
   * Flow:
   *  1. Validate circle, membership, and schedule
   *  2. Guard against duplicate contributions for the same cycle
   *  3. Calculate late penalty (if past deadline)
   *  4. DEBIT user wallet MAIN balance (contribution + penalty)
   *  5. CREDIT platform pool MAIN balance
   *  6. Record contribution
   *  7. Update membership stats + trust score
   */
  async makeContribution(userId: string, circleId: string, cycleNumber: number) {
    return await this.prisma.$transaction(
      async (tx) => {
        // ── 1. Load & validate ─────────────────────────────────────────────
        const circle = await tx.roscaCircle.findUnique({
          where: { id: circleId },
          include: {
            schedules: { where: { cycleNumber, obsoletedAt: null } },
          },
        });

        if (!circle) throw new NotFoundException('Circle not found');
        if (circle.status !== CircleStatus.ACTIVE) {
          throw new BadRequestException('Circle is not active');
        }

        const membership = await tx.roscaMembership.findUnique({
          where: { circleId_userId: { circleId, userId } },
        });

        if (!membership || membership.status !== MembershipStatus.ACTIVE) {
          throw new BadRequestException('Not an active member of this circle');
        }

        const schedule = circle.schedules[0];
        if (!schedule) {
          throw new BadRequestException(`No active schedule found for cycle ${cycleNumber}`);
        }

        // ── 2. Duplicate guard ────────────────────────────────────────────
        // The schema has @@unique([circleId, membershipId, cycleNumber]) but
        // we catch it here for a clean 400 instead of a raw P2002 500.
        const existingContribution = await tx.roscaContribution.findUnique({
          where: {
            circleId_membershipId_cycleNumber: {
              circleId,
              membershipId: membership.id,
              cycleNumber,
            },
          },
        });
        if (existingContribution) {
          throw new BadRequestException(`You have already contributed for cycle ${cycleNumber}`);
        }

        // ── 3. Wallets ─────────────────────────────────────────────────────
        const systemWallet = await tx.systemWallet.findUnique({
          where: { type: SystemWalletType.PLATFORM_POOL },
        });
        if (!systemWallet) {
          throw new InternalServerErrorException('Platform pool wallet not configured');
        }

        const userWallet = await tx.wallet.findUnique({ where: { userId } });
        if (!userWallet) {
          throw new NotFoundException('User wallet not found');
        }

        // ── 4. Penalty logic ───────────────────────────────────────────────
        const isLate = new Date() > schedule.contributionDeadline;
        const penalty = isLate
          ? (circle.contributionAmount * BigInt(Math.round(circle.latePenaltyPercent * 100))) /
            10000n
          : 0n;

        // ── 5. Pre-generate IDs ────────────────────────────────────────────
        // Generate contributionId before ledger writes so it can be used
        // as sourceId immediately — required by the append-only ledger rule.
        const contributionId = crypto.randomUUID();
        const debitRef = `CONTRIB-${crypto.randomUUID()}`;

        // ── 6. Ledger movements ────────────────────────────────────────────
        // IMPORTANT: Contributions are MAIN → MAIN transfers.
        // CREDIT/DEBIT entries MUST use BucketType.MAIN (or omit bucketType).
        // The ROSCA bucket only holds collateral RESERVES — not contribution flows.

        // 6a. DEBIT user MAIN balance (contribution amount)
        const debitEntry = await this.ledger.writeEntry(
          {
            walletId: userWallet.id,
            entryType: EntryType.DEBIT,
            movementType: MovementType.TRANSFER,
            bucketType: BucketType.MAIN, // ← MAIN, not ROSCA
            amount: circle.contributionAmount,
            reference: debitRef,
            sourceType: LedgerSourceType.CONTRIBUTION,
            sourceId: contributionId,
            metadata: { circleId, cycleNumber, isLate },
          },
          tx,
        );

        // 6b. CREDIT platform pool MAIN balance
        await this.ledger.writeEntry(
          {
            walletId: systemWallet.walletId,
            entryType: EntryType.CREDIT,
            movementType: MovementType.TRANSFER,
            bucketType: BucketType.MAIN, // ← MAIN, not ROSCA
            amount: circle.contributionAmount,
            reference: `POOL-CRED-${crypto.randomUUID()}`,
            sourceType: LedgerSourceType.CONTRIBUTION,
            sourceId: contributionId,
            metadata: { fromUserId: userId, circleId, cycleNumber },
          },
          tx,
        );

        // 6c. Penalty entries (only if late)
        if (penalty > 0n) {
          const penaltyRef = `PEN-${crypto.randomUUID()}`;

          await this.ledger.writeEntry(
            {
              walletId: userWallet.id,
              entryType: EntryType.DEBIT,
              movementType: MovementType.TRANSFER,
              // No bucketType — defaults to MAIN in LedgerService
              amount: penalty,
              reference: penaltyRef,
              sourceType: LedgerSourceType.PENALTY,
              sourceId: contributionId,
              metadata: { circleId, cycleNumber, penaltyPercent: circle.latePenaltyPercent },
            },
            tx,
          );

          await this.ledger.writeEntry(
            {
              walletId: systemWallet.walletId,
              entryType: EntryType.CREDIT,
              movementType: MovementType.TRANSFER,
              amount: penalty,
              reference: `POOL-PEN-${crypto.randomUUID()}`,
              sourceType: LedgerSourceType.PENALTY,
              sourceId: contributionId,
              metadata: { fromUserId: userId, circleId, cycleNumber },
            },
            tx,
          );
        }

        // ── 7. Record contribution ─────────────────────────────────────────
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

        // ── 8. Update membership stats ─────────────────────────────────────
        await tx.roscaMembership.update({
          where: { id: membership.id },
          data: {
            completedCycles: { increment: 1 },
            ...(isLate && { totalLatePayments: { increment: 1 } }),
            ...(penalty > 0n && { totalPenaltiesPaid: { increment: penalty } }),
          },
        });

        // ── 9. Update trust score ──────────────────────────────────────────
        await this.trustService.updateTrustScore(userId, { type: 'contribution', onTime: !isLate }, tx);

        return contribution;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Get contribution history for a specific user in a circle.
   */
  async getContributions(circleId: string, userId: string, query: ListContributionsQueryDto = {}) {
    const { cycleNumber, limit, offset } = query;

    return await this.prisma.roscaContribution.findMany({
      where: {
        circleId,
        userId,
        ...(cycleNumber !== undefined && { cycleNumber }),
      },
      take: limit ?? 20,
      skip: offset ?? 0,
      orderBy: { cycleNumber: 'desc' },
    });
  }
}
