// src/modules/ledger/ledger.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma';
import {
  LedgerEntry,
  EntryType,
  MovementType,
  BucketType,
  LedgerSourceType,
  Prisma,
} from '@prisma/client';

export interface WriteEntryParams {
  walletId: string;
  entryType: EntryType;
  movementType: MovementType;
  bucketType?: BucketType;
  amount: bigint;
  reference: string;
  metadata?: Prisma.InputJsonValue;
  sourceType: LedgerSourceType;
  sourceId: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an atomic ledger entry using the running total pattern.
   * Source of truth: balanceAfter on each entry.
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
      metadata = {},
      sourceType,
      sourceId,
    } = params;

    if (!sourceType || !sourceId) {
      throw new BadRequestException('sourceType and sourceId are required');
    }
    if (amount <= 0n) {
      throw new BadRequestException('Amount must be positive');
    }

    // Bucket rules
    if (([EntryType.RESERVE, EntryType.RELEASE] as EntryType[]).includes(entryType)) {
      if (!bucketType || bucketType === BucketType.MAIN) {
        throw new BadRequestException(`bucketType required and cannot be MAIN for ${entryType}`);
      }
    }
    if (
      ([EntryType.CREDIT, EntryType.DEBIT] as EntryType[]).includes(entryType) &&
      bucketType &&
      bucketType !== BucketType.MAIN
    ) {
      throw new BadRequestException('CREDIT/DEBIT must target MAIN bucket');
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      // Lock wallet
      await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;

      // Lock bucket if RESERVE/RELEASE
      if (
        ([EntryType.RESERVE, EntryType.RELEASE] as EntryType[]).includes(entryType) &&
        bucketType
      ) {
        await tx.$executeRaw`
          SELECT reserved_amount FROM wallet_buckets 
          WHERE wallet_id = ${walletId} 
            AND bucket_type = ${bucketType} 
            AND source_id = ${sourceId} 
          FOR UPDATE
        `;
      }

      // Get latest total balance
      const lastEntry = await tx.ledgerEntry.findFirst({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfter: true },
      });

      const currentTotal = lastEntry?.balanceAfter ?? 0n;

      // Calculate available balance
      const buckets = await tx.walletBucket.findMany({ where: { walletId } });
      const totalReserved = buckets.reduce((sum, b) => sum + b.reservedAmount, 0n);
      const currentAvailable = currentTotal - totalReserved;

      if (
        ([EntryType.DEBIT, EntryType.RESERVE] as EntryType[]).includes(entryType) &&
        amount > currentAvailable
      ) {
        throw new BadRequestException(
          `Insufficient available balance. Available: ₦${Number(currentAvailable) / 100}`,
        );
      }

      // Update bucket for RESERVE/RELEASE
      if (([EntryType.RESERVE, EntryType.RELEASE] as EntryType[]).includes(entryType)) {
        const change = entryType === EntryType.RESERVE ? amount : -amount;

        await tx.walletBucket.upsert({
          where: {
            walletId_bucketType_sourceId: {
              walletId,
              bucketType: bucketType!,
              sourceId,
            },
          },
          update: { reservedAmount: { increment: change } },
          create: {
            walletId,
            bucketType: bucketType!,
            sourceId,
            reservedAmount: amount,
          },
        });
      }

      // Calculate new total
      let balanceAfter = currentTotal;
      if (entryType === EntryType.CREDIT) balanceAfter += amount;
      if (entryType === EntryType.DEBIT) balanceAfter -= amount;

      // Prevent duplicate writes (unique constraint)
      const existing = await tx.ledgerEntry.findFirst({
        where: { walletId, reference, sourceType, sourceId },
      });
      if (existing) {
        throw new BadRequestException('Duplicate ledger entry detected');
      }

      // Create entry
      return tx.ledgerEntry.create({
        data: {
          walletId,
          reference,
          entryType,
          movementType,
          bucketType: bucketType ?? BucketType.MAIN,
          amount,
          balanceBefore: currentTotal,
          balanceAfter,
          metadata: metadata as Prisma.InputJsonValue,
          sourceType,
          sourceId,
        },
      });
    };

    return txClient
      ? execute(txClient)
      : this.prisma.$transaction(execute, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
  }

  async createReversalEntry(originalEntryId: string, reason: string): Promise<LedgerEntry> {
    const original = await this.prisma.ledgerEntry.findUnique({
      where: { id: originalEntryId },
    });

    if (!original) throw new BadRequestException('Original entry not found');

    const reversalType =
      original.entryType === EntryType.CREDIT ? EntryType.DEBIT : EntryType.CREDIT;

    return this.writeEntry({
      walletId: original.walletId,
      entryType: reversalType,
      movementType: original.movementType,
      bucketType: original.bucketType ?? undefined,
      amount: original.amount,
      reference: `REV-${original.reference}`,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      metadata: {
        reversalOf: originalEntryId,
        reason,
        originalCreatedAt: original.createdAt.toISOString(),
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
    return this.prisma.ledgerEntry.findMany({
      where: {
        walletId,
        ...(options?.sourceType && { sourceType: options.sourceType }),
        ...(options?.movementType && { movementType: options.movementType }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });
  }

  async computeTotalBalance(walletId: string): Promise<bigint> {
    const last = await this.prisma.ledgerEntry.findFirst({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });
    return last?.balanceAfter ?? 0n;
  }

  async getDetailedBalance(walletId: string) {
    const total = await this.computeTotalBalance(walletId);

    const buckets = await this.prisma.walletBucket.aggregate({
      where: { walletId },
      _sum: { reservedAmount: true },
    });

    const reserved = buckets._sum.reservedAmount ?? 0n;

    return {
      total,
      reserved,
      available: total - reserved,
    };
  }
}
