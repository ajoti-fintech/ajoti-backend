import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LedgerEntry,
  EntryType,
  Prisma,
  MovementType,
  BucketType,
  LedgerSourceType,
} from '@prisma/client';

export interface WriteEntryParams {
  walletId: string;
  entryType: EntryType;
  movementType: MovementType;
  bucketType?: BucketType;
  amount: bigint;
  reference: string;
  metadata?: any;
  sourceType: LedgerSourceType;
  sourceId: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an atomic ledger entry using the "Running Total" pattern.
   * Every entry stores the balanceAfter, making it the source of truth for current state.
   */
  async writeEntry(
    params: WriteEntryParams,
    txClient?: Prisma.TransactionClient,
  ): Promise<LedgerEntry> {
    const {
      walletId,
      entryType,
      movementType,
      bucketType,
      amount,
      reference,
      metadata,
      sourceType,
      sourceId,
    } = params;

    if (!sourceType || !sourceId) {
      throw new BadRequestException('Every ledger entry must have a sourceType and sourceId');
    }

    if (amount <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    // --- BUCKET VALIDATION LOGIC ---

    // 1. Validation for Restrictions (RESERVE/RELEASE)
    if (entryType === EntryType.RESERVE || entryType === EntryType.RELEASE) {
      if (!bucketType) {
        throw new BadRequestException(`bucketType is required for ${entryType} operations`);
      }
      if (bucketType === BucketType.MAIN) {
        throw new BadRequestException('Cannot RESERVE or RELEASE from the MAIN bucket directly');
      }
    }

    // 2. Validation for Global Balance Changes (CREDIT/DEBIT)
    if (entryType === EntryType.CREDIT || entryType === EntryType.DEBIT) {
      if (bucketType && bucketType !== BucketType.MAIN) {
        throw new BadRequestException('CREDIT/DEBIT operations must target the MAIN bucket');
      }
    }

    // Use provided transaction client or default to main prisma client
    const execute = async (tx: Prisma.TransactionClient) => {
      // 1. Pessimistic Lock: Ensure no other process moves money for this wallet simultaneously
      await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;

      // 2. Get the current state from the LATEST ledger entry
      const lastEntry = await tx.ledgerEntry.findFirst({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
      });

      const currentTotal = lastEntry?.balanceAfter ?? 0n;

      // 3. Get reserved amounts to calculate "Available" balance
      const buckets = await tx.walletBucket.findMany({ where: { walletId } });
      const totalReserved = buckets.reduce((sum, b) => sum + b.reservedAmount, 0n);
      const currentAvailable = currentTotal - totalReserved;

      // 4. Validate sufficient funds for DEBIT or RESERVE
      if (
        (entryType === EntryType.DEBIT || entryType === EntryType.RESERVE) &&
        amount > currentAvailable
      ) {
        throw new BadRequestException(
          `Insufficient available balance. Available: ${Number(currentAvailable) / 100}`,
        );
      }

      // 5. UPDATE BUCKETS (Handling Multiple Buckets per contextId)
      if (entryType === EntryType.RESERVE || entryType === EntryType.RELEASE) {
        const bucketAmountChange = entryType === EntryType.RESERVE ? amount : -amount;

        await tx.walletBucket.upsert({
          where: {
            walletId_bucketType_sourceId: {
              walletId,
              bucketType: bucketType as BucketType,
              sourceId,
            },
          },
          update: {
            reservedAmount: { increment: bucketAmountChange },
          },
          create: {
            walletId,
            bucketType: bucketType as BucketType,
            sourceId,
            reservedAmount: amount,
          },
        });
      }

      // 6. Calculate new balance snapshots
      const balanceBefore = currentTotal;
      let balanceAfter = currentTotal;

      if (entryType === EntryType.CREDIT) {
        balanceAfter = currentTotal + amount;
      } else if (entryType === EntryType.DEBIT) {
        balanceAfter = currentTotal - amount;
      }

      // 7. Create the immutable record
      return await tx.ledgerEntry.create({
        data: {
          walletId,
          reference,
          entryType,
          movementType,
          bucketType: bucketType || BucketType.MAIN,
          amount,
          balanceBefore,
          balanceAfter,
          metadata: metadata || {},
          sourceType,
          sourceId,
        },
      });
    };

    // If txClient is provided, we use it directly; otherwise, we wrap in a new transaction
    if (txClient) {
      return await execute(txClient);
    }

    return await this.prisma.$transaction(execute, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  async createReversalEntry(originalEntryId: string, reason: string): Promise<LedgerEntry> {
    const original = await this.prisma.ledgerEntry.findUnique({
      where: { id: originalEntryId },
    });

    if (!original) {
      throw new BadRequestException('Original entry not found');
    }

    const reversalType =
      original.entryType === EntryType.CREDIT ? EntryType.DEBIT : EntryType.CREDIT;

    return await this.writeEntry({
      walletId: original.walletId,
      entryType: reversalType,
      movementType: original.movementType,
      bucketType: original.bucketType || undefined,
      amount: original.amount,
      reference: `REVERSAL-${original.reference}`,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      metadata: {
        reversalOf: originalEntryId,
        reason,
        originalReference: original.reference,
      },
    });
  }

  async getHistory(
    walletId: string,
    options?: {
      limit?: number;
      offset?: number;
      sourceType?: LedgerSourceType;
      movementType?: MovementType;
    },
  ): Promise<LedgerEntry[]> {
    return await this.prisma.ledgerEntry.findMany({
      where: {
        walletId,
        ...(options?.sourceType && { sourceType: options.sourceType }),
        ...(options?.movementType && { movementType: options.movementType }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }

  async computeTotalBalance(walletId: string): Promise<bigint> {
    const lastEntry = await this.prisma.ledgerEntry.findFirst({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });
    return lastEntry?.balanceAfter ?? 0n;
  }

  async getDetailedBalance(walletId: string) {
    const total = await this.computeTotalBalance(walletId);

    const bucketSums = await this.prisma.walletBucket.aggregate({
      where: { walletId },
      _sum: { reservedAmount: true },
    });

    const reserved = bucketSums._sum.reservedAmount || 0n;

    return {
      total,
      reserved,
      available: total - reserved,
    };
  }
}
