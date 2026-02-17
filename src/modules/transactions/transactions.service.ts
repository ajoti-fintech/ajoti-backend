// src/modules/transactions/transactions.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  TransactionStatus,
  TransactionType,
  Prisma,
  EntryType,
  MovementType,
  BucketType,
  LedgerSourceType,
} from '@prisma/client';

interface CreateTransactionInput {
  walletId: string;
  amount: bigint;
  reference: string;
  type: TransactionType;
  status: TransactionStatus;
  currency?: string;
  provider?: string;
  metadata?: Prisma.InputJsonValue;
}

interface UpdateStatusExtra {
  providerReference?: string;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

interface SettlementParams {
  reference: string;
  providerId: string;
  receivedAmountNaira: number;
  providerName: string;
  webhookPayload: unknown;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Create a new transaction record (usually PENDING)
   */
  async create(input: CreateTransactionInput) {
    return this.prisma.transaction.create({
      data: {
        walletId: input.walletId,
        amount: input.amount,
        reference: input.reference,
        type: input.type,
        status: input.status,
        currency: input.currency || 'NGN',
        provider: input.provider || 'FLUTTERWAVE',
        metadata: input.metadata ?? Prisma.DbNull,
      },
    });
  }

  /**
   * Update transaction status (SUCCESS/FAILED/etc.)
   */
  async updateStatus(id: string, status: TransactionStatus, extra?: UpdateStatusExtra) {
    const completedAt =
      extra?.completedAt || (status === TransactionStatus.SUCCESS ? new Date() : null);

    return this.prisma.transaction.update({
      where: { id },
      data: {
        status,
        reference: extra?.providerReference,
        completedAt,
        metadata: extra?.metadata ? (extra.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  }

  /**
   * Atomic settlement for successful funding webhook
   * - Idempotency check
   * - Amount verification
   * - Ledger credit
   * - Transaction update
   */
  async finalizeSettlement(params: SettlementParams) {
    const { reference, providerId, receivedAmountNaira, providerName, webhookPayload } = params;

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Idempotency: record webhook first
        const recorded = await this.recordWebhookIdempotent(
          tx,
          providerName,
          providerId,
          webhookPayload,
        );
        if (!recorded) return { status: 'duplicate' };

        // 2. Lock & fetch transaction
        const transaction = await tx.transaction.findUnique({
          where: { reference },
          include: { wallet: true },
        });

        if (!transaction || transaction.status !== TransactionStatus.PENDING) {
          return { status: 'ignored', reason: 'Not pending or not found' };
        }

        // 3. Amount integrity check
        const amountCheck = this.verifyAmount(transaction.amount, receivedAmountNaira);
        if (!amountCheck.valid) {
          await this.markTransactionFailed(tx, transaction.id, amountCheck.reason!);
          return { status: 'failed', reason: amountCheck.reason };
        }

        // 4. Credit ledger (MAIN bucket) — with actual amount received
        const amountToCredit = amountCheck.overpayment
          ? BigInt(Math.round(receivedAmountNaira * 100))
          : transaction.amount;

        await this.creditLedger(
          tx,
          transaction,
          providerName,
          providerId,
          amountToCredit,
          amountCheck.overpayment,
        );

        // 5. Finalize transaction
        await this.finalizeTransaction(
          tx,
          transaction,
          providerId,
          receivedAmountNaira,
          amountToCredit,
        );

        return {
          status: 'success',
          credited: amountToCredit.toString(),
          overpayment: amountCheck.overpayment || false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Mark transaction as FAILED
   */
  async markAsFailed(reference: string, reason: string, tx?: Prisma.TransactionClient) {
    const db = tx || this.prisma;

    const transaction = await db.transaction.findUnique({ where: { reference } });
    if (!transaction) {
      this.logger.warn(`Cannot mark failed: transaction ${reference} not found`);
      return null;
    }

    return db.transaction.update({
      where: { reference },
      data: {
        status: TransactionStatus.FAILED,
        metadata: {
          ...((transaction.metadata as Record<string, any>) || {}),
          error: reason,
          failedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Find by internal reference
   */
  async findByReference(reference: string) {
    return this.prisma.transaction.findUnique({
      where: { reference },
      include: { wallet: true },
    });
  }

  /**
   * Find by provider reference (e.g. flw-xxx)
   */
  async findByProviderRef(providerRef: string) {
    return this.prisma.transaction.findFirst({
      where: { reference: providerRef },
    });
  }

  // =========================================================================
  // PRIVATE HELPERS
  // =========================================================================

  private async recordWebhookIdempotent(
    tx: Prisma.TransactionClient,
    provider: string,
    eventId: string,
    payload: unknown,
  ) {
    try {
      return await tx.webhookEvent.create({
        data: {
          provider,
          eventId: String(eventId),
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Handle Prisma known errors with type guard
      if (this.isPrismaError(error) && error.code === 'P2002') {
        return null; // Duplicate — idempotency success
      }
      throw error;
    }
  }

  private isPrismaError(error: unknown): error is { code: string } {
    return typeof error === 'object' && error !== null && 'code' in error;
  }

  private verifyAmount(expectedKobo: bigint, receivedNaira: number) {
    const receivedKobo = BigInt(Math.round(receivedNaira * 100));

    if (receivedKobo < expectedKobo) {
      return {
        valid: false,
        reason: 'underpayment',
        overpayment: false,
      };
    }

    const overpayment = receivedKobo > expectedKobo;
    if (overpayment) {
      this.logger.warn(
        `Overpayment detected: expected ${expectedKobo.toString()} kobo, ` +
          `got ${receivedKobo.toString()} kobo. Crediting full amount.`,
      );
    }

    return {
      valid: true,
      overpayment,
      reason: overpayment ? 'overpayment' : undefined,
    };
  }

  private async markTransactionFailed(
    tx: Prisma.TransactionClient,
    transactionId: string,
    reason: string,
  ) {
    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.FAILED,
        metadata: {
          error: reason,
          failedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async creditLedger(
    tx: Prisma.TransactionClient,
    transaction: any,
    providerName: string,
    providerId: string,
    amount: bigint,
    isOverpayment: boolean = false,
  ) {
    await this.ledgerService.writeEntry(
      {
        walletId: transaction.walletId,
        entryType: EntryType.CREDIT,
        movementType: MovementType.FUNDING,
        bucketType: BucketType.MAIN,
        amount,
        reference: `${providerName}-${providerId}`,
        sourceType: LedgerSourceType.TRANSACTION,
        sourceId: transaction.id,
        metadata: {
          provider: providerName,
          processorReference: providerId,
          expectedAmount: transaction.amount.toString(),
          actualAmount: amount.toString(),
          isOverpayment,
        },
      },
      tx,
    );
  }

  private async finalizeTransaction(
    tx: Prisma.TransactionClient,
    transaction: any,
    providerId: string,
    receivedAmountNaira: number,
    creditedAmount: bigint,
  ) {
    const existingMetadata = (transaction.metadata as Record<string, any>) || {};

    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: TransactionStatus.SUCCESS,
        reference: String(providerId),
        completedAt: new Date(),
        metadata: {
          ...existingMetadata,
          settled_at: new Date().toISOString(),
          webhook_amount_ngn: receivedAmountNaira,
          credited_amount_kobo: creditedAmount.toString(),
          original_amount_kobo: transaction.amount.toString(),
        } as Prisma.InputJsonValue,
      },
    });
  }
}
