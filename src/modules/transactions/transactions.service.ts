import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Transaction, TransactionStatus } from '@prisma/client';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a pending transaction record
   * Called when initiating funding or withdrawal
   */
  async createPendingTransaction(params: {
    walletId: string;
    reference: string;
    amount: bigint;
    currency?: string;
    provider?: string;
    metadata?: any;
  }): Promise<Transaction> {
    return await this.prisma.transaction.create({
      data: {
        walletId: params.walletId,
        reference: params.reference,
        amount: params.amount,
        currency: params.currency || 'NGN',
        provider: params.provider || 'FLUTTERWAVE',
        status: TransactionStatus.PENDING,
        rawPayload: params.metadata || {},
      },
    });
  }

  /**
   * Update transaction status
   */
  async updateTransactionStatus(
    reference: string,
    status: TransactionStatus,
    rawPayload?: any,
  ): Promise<Transaction> {
    return await this.prisma.transaction.update({
      where: { reference },
      data: {
        status,
        ...(rawPayload && { rawPayload }),
      },
    });
  }

  /**
   * Get transaction by reference
   */
  async getTransactionByReference(reference: string): Promise<Transaction | null> {
    return await this.prisma.transaction.findUnique({
      where: { reference },
    });
  }

  /**
   * Get transactions for a wallet
   */
  async getTransactionsByWallet(
    walletId: string,
    options?: {
      limit?: number;
      offset?: number;
      status?: TransactionStatus;
    },
  ): Promise<Transaction[]> {
    return await this.prisma.transaction.findMany({
      where: {
        walletId,
        ...(options?.status && { status: options.status }),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }
}
