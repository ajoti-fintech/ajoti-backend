import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../ledger/ledger.service';
import {
  BucketType,
  EntryType,
  MovementType,
  LedgerSourceType,
  WalletBucket,
} from '@prisma/client';

@Injectable()
export class BucketService {
  private readonly logger = new Logger(BucketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  async reserveFunds(params: {
    walletId: string;
    bucketType: BucketType;
    sourceId: string;
    amount: bigint;
    reference: string;
    metadata?: any;
  }): Promise<void> {
    const { walletId, bucketType, sourceId, amount, reference, metadata } = params;

    await this.prisma.$transaction(async (tx) => {
      // FIXED: writeEntry now correctly participates in the 'tx' context
      await this.ledgerService.writeEntry(
        {
          walletId,
          amount,
          entryType: EntryType.RESERVE,
          movementType: MovementType.TRANSFER,
          bucketType,
          sourceType: this.mapBucketToSourceType(bucketType),
          sourceId,
          reference,
          metadata: { ...metadata, action: 'RESERVE_FUNDS' },
        },
        tx,
      );

      // Bucket upserting is handled by LedgerService internal logic now,
      // but we maintain the logic here if specific metadata/state is required.
    });
  }

  async releaseFunds(params: {
    walletId: string;
    bucketType: BucketType;
    sourceId: string;
    amount: bigint;
    reference: string;
    metadata?: any;
  }): Promise<void> {
    const { walletId, bucketType, sourceId, amount, reference, metadata } = params;

    await this.prisma.$transaction(async (tx) => {
      // FIXED: writeEntry now correctly participates in the 'tx' context
      await this.ledgerService.writeEntry(
        {
          walletId,
          amount,
          entryType: EntryType.RELEASE,
          movementType: MovementType.TRANSFER,
          bucketType,
          sourceType: this.mapBucketToSourceType(bucketType),
          sourceId,
          reference,
          metadata: { ...metadata, action: 'RELEASE_FUNDS' },
        },
        tx,
      );
    });
  }

  async getBucketStatus(walletId: string): Promise<WalletBucket[]> {
    return await this.prisma.walletBucket.findMany({
      where: { walletId, reservedAmount: { gt: 0n } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private mapBucketToSourceType(type: BucketType): LedgerSourceType {
    switch (type) {
      case BucketType.ROSCA:
        return LedgerSourceType.ROSCA_CIRCLE;

      default:
        return LedgerSourceType.SYSTEM;
    }
  }
}
