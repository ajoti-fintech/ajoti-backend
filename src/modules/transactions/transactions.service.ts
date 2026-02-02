import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionStatus, Prisma, TransactionType } from '@prisma/client';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Initialize a funding transaction attempt.
   * This is recorded before redirecting the user to Flutterwave.
   */
  async createFundingAttempt(data: {
    walletId: string;
    amount: bigint;
    currency: string;
    providerReference: string; // The tx_ref sent to Flutterwave
  }) {
    return await this.prisma.transaction.create({
      data: {
        walletId: data.walletId,
        amount: data.amount,
        currency: data.currency,
        provider: 'FLUTTERWAVE',
        reference: data.providerReference,
        status: TransactionStatus.PENDING,
        type: TransactionType.FUNDING,
      },
    });
  }

  /**
   * Initialize a withdrawal transaction attempt.
   */
  async createWithdrawalAttempt(data: {
    walletId: string;
    amount: bigint;
    currency: string;
    providerReference: string;
  }) {
    return await this.prisma.transaction.create({
      data: {
        walletId: data.walletId,
        amount: data.amount,
        currency: data.currency,
        provider: 'FLUTTERWAVE',
        reference: data.providerReference,
        status: TransactionStatus.PENDING,
        type: TransactionType.WITHDRAWAL,
      },
    });
  }
  /**
   * Update transaction status after provider notification.
   */
  async updateTransactionStatus(id: string, status: TransactionStatus, metadata?: any) {
    return await this.prisma.transaction.update({
      where: { id },
      data: {
        status,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        completedAt: status === TransactionStatus.SUCCESS ? new Date() : null,
      },
    });
  }

  async findByProviderRef(ref: string) {
    return await this.prisma.transaction.findUnique({
      where: { reference: ref },
    });
  }

  /**
   * Get user's transaction history (useful for wallet controller).
   */
  async getUserTransactions(
    walletId: string,
    options?: {
      limit?: number;
      offset?: number;
      type?: TransactionType;
      status?: TransactionStatus;
    },
  ) {
    return await this.prisma.transaction.findMany({
      where: {
        walletId,
        ...(options?.type && { type: options.type }),
        ...(options?.status && { status: options.status }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }
}
