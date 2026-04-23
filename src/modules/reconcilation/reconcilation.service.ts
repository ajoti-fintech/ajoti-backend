import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EntryType, Prisma } from '@prisma/client';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Performs a manual deep-audit of a wallet's financial integrity.
   * Checks both the ledger snapshot consistency and the bucket reservation logic.
   */
  async verifyWalletIntegrity(walletId: string): Promise<{
    ledger: { isValid: boolean; snapshot: bigint; calculated: bigint; drift: bigint };
    buckets: { isValid: boolean; ledgerReserved: bigint; bucketSum: bigint; drift: bigint };
  }> {
    return await this.prisma.$transaction(
      async (tx) => {
        // 1. LEDGER INTEGRITY CHECK
        // Get the latest balanceAfter snapshot
        const lastEntry = await tx.ledgerEntry.findFirst({
          where: { walletId },
          orderBy: { createdAt: 'desc' },
          select: { balanceAfter: true },
        });
        const snapshot = lastEntry?.balanceAfter ?? 0n;

        // Sum all entries from scratch to verify the snapshot
        const aggregates = await tx.ledgerEntry.groupBy({
          by: ['entryType'],
          where: { walletId },
          _sum: { amount: true },
        });

        let calculated = 0n;
        for (const group of aggregates) {
          if (group.entryType === EntryType.CREDIT) {
            calculated += group._sum.amount ?? 0n;
          } else if (group.entryType === EntryType.DEBIT) {
            calculated -= group._sum.amount ?? 0n;
          }
        }

        const ledgerDrift = snapshot - calculated;
        const isLedgerValid = ledgerDrift === 0n;

        // 2. BUCKET INTEGRITY CHECK
        // Verify that the sum of reserved amounts in the Bucket table
        // matches the net sum of RESERVE/RELEASE entries in the Ledger.
        // Reuse the same aggregates from Step 1 — they include all entry types.
        let ledgerReserved = 0n;
        for (const group of aggregates) {
          if (group.entryType === EntryType.RESERVE) {
            ledgerReserved += group._sum.amount ?? 0n;
          } else if (group.entryType === EntryType.RELEASE) {
            ledgerReserved -= group._sum.amount ?? 0n;
          }
        }

        const bucketTableSum = await tx.walletBucket.aggregate({
          where: { walletId },
          _sum: { reservedAmount: true },
        });
        const bucketSum = bucketTableSum._sum.reservedAmount || 0n;

        const bucketDrift = ledgerReserved - bucketSum;
        const isBucketsValid = bucketDrift === 0n;

        if (!isLedgerValid || !isBucketsValid) {
          this.logger.error(`🚨 INTEGRITY BREACH: Wallet ${walletId} is out of sync!`);
        }

        return {
          ledger: {
            isValid: isLedgerValid,
            snapshot,
            calculated,
            drift: ledgerDrift,
          },
          buckets: {
            isValid: isBucketsValid,
            ledgerReserved,
            bucketSum,
            drift: bucketDrift,
          },
        };
      },
      {
        // Using ReadCommitted to avoid blocking live transactions during audit
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
  }

  /**
   * Utility to audit a batch of wallets manually.
   * Can be called from an Admin controller.
   */
  async auditMultipleWallets(walletIds: string[]) {
    const results = [];
    for (const id of walletIds) {
      results.push({
        walletId: id,
        report: await this.verifyWalletIntegrity(id),
      });
    }
    return results;
  }
}
