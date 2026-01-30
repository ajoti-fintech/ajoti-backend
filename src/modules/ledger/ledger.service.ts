import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerEntry, EntryType, Category } from '@prisma/client';
import { Prisma } from '@prisma/client';

interface WriteEntryParams {
  walletId: string;
  entryType: EntryType;
  category: Category;
  amount: bigint;
  reference: string;
  metadata?: any;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Write a ledger entry (append-only, atomic)
   * CRITICAL: This is the ONLY way to mutate wallet balance
   *
   * Rules:
   * - Append-only (no updates, no deletes)
   * - Atomic DB transaction
   * - SELECT ... FOR UPDATE on wallet
   * - Compute balance before/after
   */
  async writeEntry(params: WriteEntryParams): Promise<LedgerEntry> {
    const { walletId, entryType, category, amount, reference, metadata } = params;

    // Validate amount is positive
    if (amount <= 0n) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    return await this.prisma.$transaction(
      async (tx) => {
        // Lock the wallet row
        await tx.wallet.findUnique({
          where: { id: walletId },
        });

        // Compute current balance
        const balanceBefore = await this.computeBalanceInTransaction(tx, walletId);

        // Compute new balance based on entry type
        let balanceAfter: bigint;
        switch (entryType) {
          case EntryType.CREDIT:
            balanceAfter = balanceBefore + amount;
            break;
          case EntryType.DEBIT:
            balanceAfter = balanceBefore - amount;
            if (balanceAfter < 0n) {
              throw new BadRequestException('Insufficient balance');
            }
            break;
          case EntryType.RESERVE:
          case EntryType.RELEASE:
            // These don't affect total balance, only available balance
            balanceAfter = balanceBefore;
            break;
          default:
            throw new BadRequestException(`Invalid entry type: ${entryType}`);
        }

        // Create ledger entry
        const entry = await tx.ledgerEntry.create({
          data: {
            walletId,
            reference,
            entryType,
            category,
            amount,
            balanceBefore,
            balanceAfter,
            metadata: metadata || {},
          },
        });

        return entry;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * Compute balance from ledger entries
   * total = Σ(CREDIT) − Σ(DEBIT)
   *
   * Note: RESERVE and RELEASE don't affect total balance
   */
  async computeBalance(walletId: string): Promise<bigint> {
    const aggregations = await this.prisma.ledgerEntry.groupBy({
      by: ['entryType'],
      where: {
        walletId,
        entryType: {
          in: [EntryType.CREDIT, EntryType.DEBIT],
        },
      },
      _sum: {
        amount: true,
      },
    });

    let total = 0n;

    for (const agg of aggregations) {
      const sum = agg._sum.amount || 0n;
      if (agg.entryType === EntryType.CREDIT) {
        total += sum;
      } else if (agg.entryType === EntryType.DEBIT) {
        total -= sum;
      }
    }

    return total;
  }

  /**
   * Compute balance within a transaction (for atomic operations)
   */
  private async computeBalanceInTransaction(
    tx: Prisma.TransactionClient,
    walletId: string,
  ): Promise<bigint> {
    const aggregations = await tx.ledgerEntry.groupBy({
      by: ['entryType'],
      where: {
        walletId,
        entryType: {
          in: [EntryType.CREDIT, EntryType.DEBIT],
        },
      },
      _sum: {
        amount: true,
      },
    });

    let total = 0n;

    for (const agg of aggregations) {
      const sum = agg._sum.amount || 0n;
      if (agg.entryType === EntryType.CREDIT) {
        total += sum;
      } else if (agg.entryType === EntryType.DEBIT) {
        total -= sum;
      }
    }

    return total;
  }

  /**
   * Get ledger history for a wallet
   */
  async getHistory(
    walletId: string,
    options?: {
      limit?: number;
      offset?: number;
      category?: Category;
    },
  ): Promise<LedgerEntry[]> {
    return await this.prisma.ledgerEntry.findMany({
      where: {
        walletId,
        ...(options?.category && { category: options.category }),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }

  /**
   * Create a reversal entry (for failed withdrawals, etc.)
   */
  async createReversalEntry(originalEntryId: string, reason: string): Promise<LedgerEntry> {
    const originalEntry = await this.prisma.ledgerEntry.findUnique({
      where: { id: originalEntryId },
    });

    if (!originalEntry) {
      throw new BadRequestException('Original entry not found');
    }

    // Create opposite entry type
    const reversalType =
      originalEntry.entryType === EntryType.CREDIT ? EntryType.DEBIT : EntryType.CREDIT;

    return await this.writeEntry({
      walletId: originalEntry.walletId,
      entryType: reversalType,
      category: originalEntry.category,
      amount: originalEntry.amount,
      reference: `REVERSAL-${originalEntry.reference}`,
      metadata: {
        reversalOf: originalEntryId,
        reason,
        originalReference: originalEntry.reference,
      },
    });
  }
}
