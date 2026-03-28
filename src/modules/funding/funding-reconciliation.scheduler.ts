import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EntryType,
  LedgerSourceType,
  MovementType,
  Prisma,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  FlutterwaveProvider,
  FlwVerifyTransactionResponse,
} from '../flutterwave/flutterwave.provider';
import { AxiosError } from 'axios';

type ReconcileSource = 'RECONCILIATION_JOB' | 'MANUAL';

interface ReconcileContext {
  source: ReconcileSource;
  actorId?: string;
}

export type ManualFundingReconcileOutcome =
  | 'settled'
  | 'already_processed'
  | 'not_found'
  | 'still_pending'
  | 'marked_failed'
  | 'provider_error'
  | 'provider_non_success'
  | 'verification_mismatch';

export interface ManualFundingReconcileResult {
  reference: string;
  outcome: ManualFundingReconcileOutcome;
  reconciledAt: string;
  transactionId?: string;
  transactionStatus?: TransactionStatus;
  transactionType?: TransactionType;
  providerStatus?: string;
  paymentType?: string;
  amountKobo?: string;
  reason?: string;
  providerMessage?: string;
  providerErrorCode?: string | number;
}

/**
 * Reconciliation safety net for hosted-checkout funding.
 *
 * Why this exists:
 * - Webhooks can be delayed/missed/misconfigured.
 * - Pending transactions should still settle by querying Flutterwave.
 *
 * Scope:
 * - FUNDING transactions in PENDING state older than the grace period.
 * - NGN only.
 */
@Injectable()
export class FundingReconciliationScheduler {
  private readonly logger = new Logger(FundingReconciliationScheduler.name);
  private static readonly GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly BATCH_SIZE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly flw: FlutterwaveProvider,
  ) {}

  @Cron('*/2 * * * *')
  async reconcilePendingFundingTransactions(): Promise<void> {
    const cutoff = new Date(Date.now() - FundingReconciliationScheduler.GRACE_PERIOD_MS);

    const pending = await this.prisma.transaction.findMany({
      where: {
        type: TransactionType.FUNDING,
        status: TransactionStatus.PENDING,
        createdAt: { lte: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      take: FundingReconciliationScheduler.BATCH_SIZE,
    });

    if (pending.length === 0) {
      this.logger.debug('No stale pending funding transactions found');
      return;
    }

    this.logger.log(`Reconciling ${pending.length} stale pending funding transaction(s)`);

    for (const tx of pending) {
      try {
        await this.reconcileOne(tx);
      } catch (error) {
        this.logger.error(`Funding reconciliation failed for ref=${tx.reference}`, error);
      }
    }
  }

  async reconcileByReference(
    reference: string,
    superAdminId: string,
  ): Promise<ManualFundingReconcileResult> {
    const normalizedReference = reference.trim();
    const reconciledAt = new Date().toISOString();

    const current = await this.prisma.transaction.findUnique({
      where: { reference: normalizedReference },
    });

    if (!current) {
      return {
        reference: normalizedReference,
        outcome: 'not_found',
        reconciledAt,
      };
    }

    if (current.status !== TransactionStatus.PENDING) {
      return {
        reference: normalizedReference,
        outcome: 'already_processed',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: current.status,
        transactionType: current.type,
      };
    }

    let verifyResult: FlwVerifyTransactionResponse;
    try {
      verifyResult = await this.flw.verifyTransactionByReference(normalizedReference);
    } catch (error) {
      const providerError = this.extractProviderError(error);
      return {
        reference: normalizedReference,
        outcome: 'provider_error',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: current.status,
        transactionType: current.type,
        reason: 'provider_verification_unavailable',
        providerMessage: providerError.message,
        providerErrorCode: providerError.code,
      };
    }

    if (verifyResult.status !== 'success' || !verifyResult.data) {
      return {
        reference: normalizedReference,
        outcome: 'provider_non_success',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: current.status,
        transactionType: current.type,
        reason: 'provider_non_success_response',
        providerMessage: verifyResult.message,
      };
    }

    const providerTx = verifyResult.data;

    if (providerTx.tx_ref !== current.reference) {
      return {
        reference: normalizedReference,
        outcome: 'verification_mismatch',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: current.status,
        transactionType: current.type,
        providerStatus: providerTx.status,
        paymentType: providerTx.payment_type ?? 'unknown',
        reason: `tx_ref_mismatch_db_${current.reference}_provider_${providerTx.tx_ref}`,
      };
    }

    if (providerTx.currency !== 'NGN') {
      await this.markFailed(current.id, `Unexpected currency: ${providerTx.currency}`, {
        source: 'MANUAL',
        actorId: superAdminId,
      });

      return {
        reference: normalizedReference,
        outcome: 'marked_failed',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: TransactionStatus.FAILED,
        transactionType: current.type,
        providerStatus: providerTx.status,
        paymentType: providerTx.payment_type ?? 'unknown',
        reason: `currency_mismatch_${providerTx.currency}`,
      };
    }

    const paidAmountKobo = BigInt(Math.round(providerTx.amount * 100));
    const fundingMethodLabel = this.resolveFundingMethodLabel(providerTx.payment_type);
    const fundingTransactionType = this.resolveFundingTransactionType(providerTx.payment_type);

    if (providerTx.status === 'successful') {
      if (paidAmountKobo < current.amount) {
        await this.markFailed(
          current.id,
          `Underpayment: expected ${current.amount.toString()} kobo, got ${paidAmountKobo.toString()} kobo`,
          {
            source: 'MANUAL',
            actorId: superAdminId,
          },
        );

        return {
          reference: normalizedReference,
          outcome: 'marked_failed',
          reconciledAt,
          transactionId: current.id,
          transactionStatus: TransactionStatus.FAILED,
          transactionType: current.type,
          providerStatus: providerTx.status,
          paymentType: providerTx.payment_type ?? 'unknown',
          amountKobo: paidAmountKobo.toString(),
          reason: 'underpayment',
        };
      }

      await this.settleSuccessfulFunding(
        current.id,
        providerTx,
        fundingMethodLabel,
        fundingTransactionType,
        {
          source: 'MANUAL',
          actorId: superAdminId,
        },
      );

      return {
        reference: normalizedReference,
        outcome: 'settled',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: TransactionStatus.SUCCESS,
        transactionType: fundingTransactionType,
        providerStatus: providerTx.status,
        paymentType: providerTx.payment_type ?? 'unknown',
        amountKobo: paidAmountKobo.toString(),
      };
    }

    if (providerTx.status === 'failed') {
      await this.markFailed(current.id, 'Provider marked transaction as failed', {
        source: 'MANUAL',
        actorId: superAdminId,
      });

      return {
        reference: normalizedReference,
        outcome: 'marked_failed',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: TransactionStatus.FAILED,
        transactionType: current.type,
        providerStatus: providerTx.status,
        paymentType: providerTx.payment_type ?? 'unknown',
        amountKobo: paidAmountKobo.toString(),
        reason: 'provider_status_failed',
      };
    }

    return {
      reference: normalizedReference,
      outcome: 'still_pending',
      reconciledAt,
      transactionId: current.id,
      transactionStatus: current.status,
      transactionType: current.type,
      providerStatus: providerTx.status,
      paymentType: providerTx.payment_type ?? 'unknown',
      amountKobo: paidAmountKobo.toString(),
      reason: 'provider_status_pending',
    };
  }

  private async reconcileOne(transaction: Transaction): Promise<void> {
    const fresh = await this.prisma.transaction.findUnique({
      where: { id: transaction.id },
    });

    if (!fresh || fresh.status !== TransactionStatus.PENDING) {
      return;
    }

    let verifyResult: FlwVerifyTransactionResponse;
    try {
      verifyResult = await this.flw.verifyTransactionByReference(fresh.reference);
    } catch (error) {
      this.logger.warn(
        `Provider verification unavailable for ref=${fresh.reference}; will retry next cycle`,
      );
      return;
    }

    if (verifyResult.status !== 'success' || !verifyResult.data) {
      this.logger.warn(
        `Provider returned non-success for ref=${fresh.reference}: ${verifyResult.message}`,
      );
      return;
    }

    const providerTx = verifyResult.data;

    if (providerTx.tx_ref !== fresh.reference) {
      this.logger.error(
        `Reconciliation tx_ref mismatch: db=${fresh.reference} provider=${providerTx.tx_ref}`,
      );
      return;
    }

    if (providerTx.currency !== 'NGN') {
      await this.markFailed(
        fresh.id,
        `Unexpected currency during reconciliation: ${providerTx.currency}`,
        { source: 'RECONCILIATION_JOB' },
      );
      return;
    }

    const paidAmountKobo = BigInt(Math.round(providerTx.amount * 100));
    const fundingMethodLabel = this.resolveFundingMethodLabel(providerTx.payment_type);
    const fundingTransactionType = this.resolveFundingTransactionType(providerTx.payment_type);

    if (providerTx.status === 'successful') {
      if (paidAmountKobo < fresh.amount) {
        await this.markFailed(
          fresh.id,
          `Underpayment: expected ${fresh.amount.toString()} kobo, got ${paidAmountKobo.toString()} kobo`,
          { source: 'RECONCILIATION_JOB' },
        );
        return;
      }

      await this.settleSuccessfulFunding(
        fresh.id,
        providerTx,
        fundingMethodLabel,
        fundingTransactionType,
        { source: 'RECONCILIATION_JOB' },
      );
      return;
    }

    if (providerTx.status === 'failed') {
      await this.markFailed(fresh.id, 'Provider marked transaction as failed', {
        source: 'RECONCILIATION_JOB',
      });
      return;
    }

    this.logger.debug(
      `Reconciliation still pending for ref=${fresh.reference} (provider status=${providerTx.status})`,
    );
  }

  private async settleSuccessfulFunding(
    transactionId: string,
    providerTx: FlwVerifyTransactionResponse['data'],
    fundingMethodLabel: string,
    fundingTransactionType: TransactionType,
    context: ReconcileContext,
  ): Promise<void> {
    const paidAmountKobo = BigInt(Math.round(providerTx.amount * 100));
    const reconciledAt = new Date().toISOString();

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!current || current.status !== TransactionStatus.PENDING) {
        return;
      }

      await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${current.walletId} FOR UPDATE`;

      const last = await tx.ledgerEntry.findFirst({
        where: { walletId: current.walletId },
        orderBy: { createdAt: 'desc' },
        select: { balanceAfter: true },
      });

      const balanceBefore = last?.balanceAfter ?? 0n;
      const balanceAfter = balanceBefore + paidAmountKobo;
      const fundingReference = `${fundingMethodLabel}-${current.id}`;

      await tx.ledgerEntry.create({
        data: {
          walletId: current.walletId,
          reference: fundingReference,
          entryType: EntryType.CREDIT,
          movementType: MovementType.FUNDING,
          amount: paidAmountKobo,
          balanceBefore,
          balanceAfter,
          sourceType: LedgerSourceType.TRANSACTION,
          sourceId: current.id,
          metadata: {
            provider: 'FLUTTERWAVE',
            source: context.source,
            flwTransactionId: providerTx.id,
            flwRef: providerTx.flw_ref,
            verifiedAmountKobo: paidAmountKobo.toString(),
            verifiedAt: reconciledAt,
            fundingMethodLabel,
            ...(context.source === 'MANUAL'
              ? {
                  manualReconciledBy: context.actorId ?? null,
                  manualReconciledAt: reconciledAt,
                }
              : {
                  reconciledByJobAt: reconciledAt,
                }),
          },
        },
      });

      await tx.transaction.update({
        where: { id: current.id },
        data: {
          type: fundingTransactionType,
          status: TransactionStatus.SUCCESS,
          completedAt: new Date(),
          metadata: {
            ...(current.metadata as object),
            flwTransactionId: providerTx.id,
            flwRef: providerTx.flw_ref,
            verifiedPaymentType: providerTx.payment_type ?? null,
            chargedAmount: providerTx.charged_amount,
            verifiedAmountKobo: paidAmountKobo.toString(),
            fundingMethodLabel,
            fundingLedgerReference: fundingReference,
            ...(context.source === 'MANUAL'
              ? {
                  manualReconciledBy: context.actorId ?? null,
                  manualReconciledAt: reconciledAt,
                }
              : {
                  reconciledByJobAt: reconciledAt,
                }),
          },
        },
      });
    });

    this.logger.log(
      `Reconciled and settled funding ref=${providerTx.tx_ref} amount=${paidAmountKobo.toString()} kobo`,
    );
  }

  private async markFailed(
    transactionId: string,
    reason: string,
    context: ReconcileContext,
  ): Promise<void> {
    const current = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!current || current.status !== TransactionStatus.PENDING) {
      return;
    }

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.FAILED,
        metadata: {
          ...(current.metadata as Prisma.JsonObject | null),
          reconciliationFailureReason: reason,
          ...(context.source === 'MANUAL'
            ? {
                manualReconciledBy: context.actorId ?? null,
                manualReconciledAt: new Date().toISOString(),
              }
            : {
                reconciledByJobAt: new Date().toISOString(),
              }),
        },
      },
    });

    this.logger.warn(`Marked funding transaction failed during reconciliation: ${reason}`);
  }

  private resolveFundingMethodLabel(providerPaymentType?: string): string {
    const paymentType = providerPaymentType?.toLowerCase().trim();

    if (paymentType === 'card') {
      return 'Funding-Card';
    }

    if (paymentType === 'bank_transfer' || paymentType === 'banktransfer') {
      return 'Funding-BankTransfer';
    }

    if (paymentType === 'ussd') {
      return 'Funding-USSD';
    }

    if (paymentType === 'account') {
      return 'Funding-Account';
    }

    return 'Funding-Unknown';
  }

  private resolveFundingTransactionType(providerPaymentType?: string): TransactionType {
    const paymentType = providerPaymentType?.toLowerCase().trim();

    if (paymentType === 'card') {
      return TransactionType.FUNDING_CARD;
    }

    if (paymentType === 'bank_transfer' || paymentType === 'banktransfer') {
      return TransactionType.FUNDING_BANKTRANSFER;
    }

    if (paymentType === 'ussd') {
      return TransactionType.FUNDING_USSD;
    }

    if (paymentType === 'account') {
      return TransactionType.FUNDING_ACCOUNT;
    }

    return TransactionType.FUNDING;
  }

  private extractProviderError(
    error: unknown,
  ): { message: string; code?: string | number } {
    if (!(error instanceof AxiosError)) {
      return {
        message: error instanceof Error ? error.message : 'Provider verification failed',
      };
    }

    const responseData = error.response?.data as Record<string, unknown> | undefined;
    const nestedData =
      responseData && typeof responseData.data === 'object' && responseData.data !== null
        ? (responseData.data as Record<string, unknown>)
        : undefined;

    const candidateCode = nestedData?.code ?? responseData?.code ?? responseData?.response_code;
    const candidateMessage =
      (typeof responseData?.message === 'string' && responseData.message) ||
      (typeof nestedData?.message === 'string' && nestedData.message) ||
      error.message ||
      'Provider verification failed';

    return {
      message: candidateMessage,
      code:
        typeof candidateCode === 'string' || typeof candidateCode === 'number'
          ? candidateCode
          : undefined,
    };
  }
}
