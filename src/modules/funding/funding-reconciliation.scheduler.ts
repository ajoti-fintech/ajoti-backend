import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  EntryType,
  LedgerSourceType,
  MovementType,
  Prisma,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { AxiosError } from 'axios';
import { DelayedError, Job, Queue } from 'bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import {
  FlutterwaveProvider,
  FlwVerifyTransactionResponse,
} from '../flutterwave/flutterwave.provider';
import {
  FUNDING_RECONCILIATION_QUEUE,
  FundingReconciliationJobData,
  FundingReconciliationJobName,
} from './funding.queue';

type ReconcileSource = 'RECONCILIATION_JOB' | 'MANUAL' | 'USER_VERIFY';

interface ReconcileContext {
  source: ReconcileSource;
  actorId?: string;
}

interface QueueRetryState {
  backgroundJobLastAttemptAt: string;
  backgroundJobLastOutcome: string;
  backgroundJobRetryCount: number;
  backgroundJobLastProviderStatus?: string | null;
  backgroundJobLastProviderMessage?: string | null;
  backgroundJobStoppedAt?: string;
  backgroundJobStoppedReason?: string;
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

@Injectable()
export class FundingReconciliationScheduler implements OnModuleInit {
  private readonly logger = new Logger(FundingReconciliationScheduler.name);
  private static readonly INITIAL_DELAY_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly RETRY_DELAY_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly MAX_BACKGROUND_RETRY_WINDOW_MS = 3 * 60 * 60 * 1000; // 3 hours
  private static readonly STARTUP_CATCH_UP_BATCH_SIZE = 100;
  private static readonly MISSING_PROVIDER_RECORD_FAIL_AFTER_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly flw: FlutterwaveProvider,
    @InjectQueue(FUNDING_RECONCILIATION_QUEUE)
    private readonly fundingQueue: Queue<FundingReconciliationJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.enqueueStartupCatchUpJobs();
    } catch (error) {
      this.logger.error(
        'Failed to enqueue startup funding reconciliation jobs',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async scheduleInitialVerification(reference: string): Promise<void> {
    await this.scheduleVerification(reference, {
      delayMs: FundingReconciliationScheduler.INITIAL_DELAY_MS,
    });
  }

  async scheduleVerification(
    reference: string,
    options?: { delayMs?: number },
  ): Promise<void> {
    const normalizedReference = reference.trim();
    if (!normalizedReference) {
      return;
    }

    const existingJob = await this.fundingQueue.getJob(normalizedReference);
    if (existingJob) {
      return;
    }

    await this.fundingQueue.add(
      FundingReconciliationJobName.VERIFY_PENDING,
      { reference: normalizedReference },
      {
        jobId: normalizedReference,
        delay: options?.delayMs ?? FundingReconciliationScheduler.INITIAL_DELAY_MS,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60_000,
        },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }

  async processQueuedVerification(
    job: Job<FundingReconciliationJobData>,
    token?: string,
  ): Promise<void> {
    const reference = job.data.reference?.trim() || job.id?.trim() || '';
    if (!reference) {
      this.logger.warn(`Skipping funding reconciliation job ${job.id}: missing reference`);
      return;
    }

    const current = await this.prisma.transaction.findUnique({
      where: { reference },
    });

    if (!current) {
      this.logger.warn(`Queued funding reconciliation skipped: ref=${reference} not found`);
      return;
    }

    if (current.status !== TransactionStatus.PENDING) {
      this.logger.debug(
        `Queued funding reconciliation skipped: ref=${reference} already ${current.status}`,
      );
      return;
    }

    const result = await this.reconcilePendingTransaction(current, {
      source: 'RECONCILIATION_JOB',
    });

    if (result.outcome === 'still_pending') {
      await this.handleQueueRetryState(current, job, token, {
        backgroundJobLastOutcome: 'still_pending',
        backgroundJobLastProviderStatus: result.providerStatus ?? null,
        backgroundJobLastProviderMessage: result.providerMessage ?? null,
      });
      return;
    }

    if (result.outcome === 'provider_error' || result.outcome === 'provider_non_success') {
      await this.handleQueueRetryState(current, job, token, {
        backgroundJobLastOutcome: result.outcome,
        backgroundJobLastProviderStatus: result.providerStatus ?? null,
        backgroundJobLastProviderMessage: result.providerMessage ?? null,
      });
      return;
    }

    if (result.outcome === 'verification_mismatch') {
      const now = new Date().toISOString();
      await this.updatePendingMetadata(current.id, current.metadata, {
        backgroundJobLastAttemptAt: now,
        backgroundJobLastOutcome: 'verification_mismatch',
        backgroundJobRetryCount: this.getBackgroundRetryCount(current.metadata) + 1,
        backgroundJobLastProviderStatus: result.providerStatus ?? null,
        backgroundJobLastProviderMessage: result.providerMessage ?? null,
        backgroundJobStoppedAt: now,
        backgroundJobStoppedReason: result.reason ?? 'verification_mismatch',
      });

      this.logger.error(
        `Queued funding reconciliation stopped for ref=${reference}: ${result.reason ?? 'verification mismatch'}`,
      );
    }
  }

  async reconcileByReference(
    reference: string,
    actorId: string,
    source: Extract<ReconcileSource, 'MANUAL' | 'USER_VERIFY'> = 'MANUAL',
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

    return this.reconcilePendingTransaction(current, {
      source,
      actorId,
    });
  }

  private async reconcilePendingTransaction(
    current: {
      id: string;
      walletId: string;
      reference: string;
      amount: bigint;
      status: TransactionStatus;
      type: TransactionType;
      createdAt: Date;
      metadata: Prisma.JsonValue | null;
    },
    context: ReconcileContext,
  ): Promise<ManualFundingReconcileResult> {
    const reconciledAt = new Date().toISOString();

    let verifyResult: FlwVerifyTransactionResponse;
    try {
      verifyResult = await this.flw.verifyTransactionByReference(current.reference);
    } catch (error) {
      const providerError = this.extractProviderError(error);

      if (this.shouldFailMissingProviderRecord(current.createdAt, providerError.message)) {
        await this.markFailed(
          current.id,
          `Provider has no transaction record for ref=${current.reference} after timeout`,
          context,
        );

        return {
          reference: current.reference,
          outcome: 'marked_failed',
          reconciledAt,
          transactionId: current.id,
          transactionStatus: TransactionStatus.FAILED,
          transactionType: current.type,
          reason: 'provider_record_missing_timeout',
          providerMessage: providerError.message,
          providerErrorCode: providerError.code,
        };
      }

      return {
        reference: current.reference,
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
        reference: current.reference,
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
        reference: current.reference,
        outcome: 'verification_mismatch',
        reconciledAt,
        transactionId: current.id,
        transactionStatus: current.status,
        transactionType: current.type,
        providerStatus: providerTx.status,
        paymentType: providerTx.payment_type ?? 'unknown',
        providerMessage: verifyResult.message,
        reason: `tx_ref_mismatch_db_${current.reference}_provider_${providerTx.tx_ref}`,
      };
    }

    if (providerTx.currency !== 'NGN') {
      await this.markFailed(current.id, `Unexpected currency: ${providerTx.currency}`, context);

      return {
        reference: current.reference,
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
          context,
        );

        return {
          reference: current.reference,
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
        context,
      );

      return {
        reference: current.reference,
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
      await this.markFailed(current.id, 'Provider marked transaction as failed', context);

      return {
        reference: current.reference,
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
      reference: current.reference,
      outcome: 'still_pending',
      reconciledAt,
      transactionId: current.id,
      transactionStatus: current.status,
      transactionType: current.type,
      providerStatus: providerTx.status,
      paymentType: providerTx.payment_type ?? 'unknown',
      amountKobo: paidAmountKobo.toString(),
      providerMessage: verifyResult.message,
      reason: 'provider_status_pending',
    };
  }

  private async handleQueueRetryState(
    current: {
      id: string;
      reference: string;
      createdAt: Date;
      metadata: Prisma.JsonValue | null;
    },
    job: Job<FundingReconciliationJobData>,
    token: string | undefined,
    state: Pick<
      QueueRetryState,
      'backgroundJobLastOutcome' | 'backgroundJobLastProviderStatus' | 'backgroundJobLastProviderMessage'
    >,
  ): Promise<void> {
    const now = new Date().toISOString();
    const retryCount = this.getBackgroundRetryCount(current.metadata) + 1;

    if (this.shouldStopAutomaticRetries(current.createdAt)) {
      await this.updatePendingMetadata(current.id, current.metadata, {
        backgroundJobLastAttemptAt: now,
        backgroundJobLastOutcome: state.backgroundJobLastOutcome,
        backgroundJobRetryCount: retryCount,
        backgroundJobLastProviderStatus: state.backgroundJobLastProviderStatus ?? null,
        backgroundJobLastProviderMessage: state.backgroundJobLastProviderMessage ?? null,
        backgroundJobStoppedAt: now,
        backgroundJobStoppedReason: 'max_retry_window_reached',
      });

      this.logger.warn(
        `Stopped automatic funding retries for ref=${current.reference} after retry window elapsed`,
      );
      return;
    }

    await this.updatePendingMetadata(current.id, current.metadata, {
      backgroundJobLastAttemptAt: now,
      backgroundJobLastOutcome: state.backgroundJobLastOutcome,
      backgroundJobRetryCount: retryCount,
      backgroundJobLastProviderStatus: state.backgroundJobLastProviderStatus ?? null,
      backgroundJobLastProviderMessage: state.backgroundJobLastProviderMessage ?? null,
    });

    await this.requeueJob(job, token, current.reference);
  }

  private async requeueJob(
    job: Job<FundingReconciliationJobData>,
    token: string | undefined,
    reference: string,
  ): Promise<void> {
    if (!token) {
      await this.scheduleVerification(reference, {
        delayMs: FundingReconciliationScheduler.RETRY_DELAY_MS,
      });
      return;
    }

    await job.moveToDelayed(Date.now() + FundingReconciliationScheduler.RETRY_DELAY_MS, token);
    throw new DelayedError(`Funding reconciliation requeued for ${reference}`);
  }

  private async enqueueStartupCatchUpJobs(): Promise<void> {
    const pending = await this.loadPendingFundingTransactions();
    if (!pending || pending.length === 0) {
      return;
    }

    for (const transaction of pending) {
      const delayMs = this.computeInitialDelay(transaction.createdAt);
      await this.scheduleVerification(transaction.reference, { delayMs });
    }

    this.logger.log(`Queued ${pending.length} pending funding reconciliation job(s) on startup`);
  }

  private computeInitialDelay(createdAt: Date): number {
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs >= FundingReconciliationScheduler.INITIAL_DELAY_MS) {
      return 0;
    }

    return FundingReconciliationScheduler.INITIAL_DELAY_MS - ageMs;
  }

  private shouldStopAutomaticRetries(createdAt: Date): boolean {
    return Date.now() - createdAt.getTime() >= FundingReconciliationScheduler.MAX_BACKGROUND_RETRY_WINDOW_MS;
  }

  private shouldFailMissingProviderRecord(createdAt: Date, errorMessage: string): boolean {
    const isMissingRecord = /no transaction|not found|does not exist/i.test(errorMessage);
    const isOldEnough =
      Date.now() - createdAt.getTime() >=
      FundingReconciliationScheduler.MISSING_PROVIDER_RECORD_FAIL_AFTER_MS;
    return isMissingRecord && isOldEnough;
  }


  private async updatePendingMetadata(
    transactionId: string,
    currentMetadata: Prisma.JsonValue | null,
    data: QueueRetryState,
  ): Promise<void> {
    const existingMetadata = this.asJsonObject(currentMetadata);

    await this.prisma.transaction.updateMany({
      where: {
        id: transactionId,
        status: TransactionStatus.PENDING,
      },
      data: {
        metadata: {
          ...existingMetadata,
          ...data,
        } as Prisma.InputJsonValue,
      },
    });
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
    const contextMetadata = this.buildContextMetadata(context, reconciledAt);

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
            ...contextMetadata,
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
            ...this.asJsonObject(current.metadata),
            flwTransactionId: providerTx.id,
            flwRef: providerTx.flw_ref,
            verifiedPaymentType: providerTx.payment_type ?? null,
            chargedAmount: providerTx.charged_amount,
            verifiedAmountKobo: paidAmountKobo.toString(),
            fundingMethodLabel,
            fundingLedgerReference: fundingReference,
            ...contextMetadata,
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

    const failedAt = new Date();
    const failedAtIso = failedAt.toISOString();

    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatus.FAILED,
        completedAt: failedAt,
        metadata: {
          ...this.asJsonObject(current.metadata),
          reconciliationFailureReason: reason,
          failedAt: failedAtIso,
          ...this.buildContextMetadata(context, failedAtIso),
        },
      },
    });

    this.logger.warn(`Marked funding transaction failed during reconciliation: ${reason}`);
  }

  private buildContextMetadata(
    context: ReconcileContext,
    reconciledAt: string,
  ): Record<string, string | null> {
    if (context.source === 'MANUAL') {
      return {
        manualReconciledBy: context.actorId ?? null,
        manualReconciledAt: reconciledAt,
      };
    }

    if (context.source === 'USER_VERIFY') {
      return {
        verifiedByUserId: context.actorId ?? null,
        userVerifiedAt: reconciledAt,
      };
    }

    return {
      reconciledByJobAt: reconciledAt,
    };
  }

  private async loadPendingFundingTransactions(): Promise<
    Array<{ reference: string; createdAt: Date }> | null
  > {
    try {
      return await this.fetchPendingFundingTransactions();
    } catch (error) {
      if (!this.isRecoverableConnectionError(error)) {
        throw error;
      }

      this.logger.warn(
        'Funding startup catch-up skipped: database connection issue detected. Attempting Prisma reconnect.',
      );

      const reconnected = await this.reconnectPrismaClient();
      if (!reconnected) {
        return null;
      }

      await this.sleep(Number(process.env.FUNDING_RECON_RETRY_DELAY_MS ?? '2000'));

      try {
        return await this.fetchPendingFundingTransactions();
      } catch (retryError) {
        if (!this.isRecoverableConnectionError(retryError)) {
          throw retryError;
        }

        this.logger.warn(
          'Funding startup catch-up retry skipped: database connection still unavailable.',
        );
        return null;
      }
    }
  }

  private async fetchPendingFundingTransactions(): Promise<Array<{ reference: string; createdAt: Date }>> {
    return this.prisma.transaction.findMany({
      where: {
        type: TransactionType.FUNDING,
        status: TransactionStatus.PENDING,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        reference: true,
        createdAt: true,
      },
      take: FundingReconciliationScheduler.STARTUP_CATCH_UP_BATCH_SIZE,
    });
  }

  private asJsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Prisma.JsonObject)
      : {};
  }

  private getBackgroundRetryCount(value: Prisma.JsonValue | null): number {
    const metadata = this.asJsonObject(value);
    const count = metadata.backgroundJobRetryCount;
    return typeof count === 'number' && Number.isFinite(count) ? count : 0;
  }

  private isRecoverableConnectionError(error: unknown): boolean {
    for (const candidate of this.getErrorChain(error)) {
      const code = this.getErrorCode(candidate);
      if (
        code &&
        [
          'P1001',
          'P1002',
          'P1017',
          'EACCES',
          'ETIMEDOUT',
          'ECONNRESET',
          'ECONNREFUSED',
          'EPIPE',
          'EHOSTUNREACH',
          'EAI_AGAIN',
        ].includes(code.toUpperCase())
      ) {
        return true;
      }

      if (candidate instanceof Error && this.isConnectionErrorMessage(candidate.message)) {
        return true;
      }
    }

    return false;
  }

  private getErrorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }

  private isConnectionErrorMessage(message: string): boolean {
    return (
      /server has closed the connection|connection closed|connection terminated/i.test(message) ||
      /connection timeout|timed out|etimedout|econnreset|econnrefused/i.test(message)
    );
  }

  private getErrorChain(error: unknown): unknown[] {
    const chain: unknown[] = [];
    let current: unknown = error;
    let depth = 0;

    while (current && depth < 6) {
      chain.push(current);

      if (typeof current !== 'object') {
        break;
      }

      const next = (current as { cause?: unknown }).cause;
      if (!next || next === current) {
        break;
      }

      current = next;
      depth += 1;
    }

    return chain;
  }

  private async reconnectPrismaClient(): Promise<boolean> {
    try {
      await this.prisma.$disconnect();
    } catch {
      // Ignore disconnect errors; we only care about getting a fresh connection.
    }

    const maxAttempts = Number(process.env.DB_RECONNECT_ATTEMPTS ?? '3');
    const baseDelayMs = Number(process.env.DB_RECONNECT_BACKOFF_MS ?? '1000');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.prisma.$connect();
        await this.prisma.$queryRaw`SELECT 1`;
        this.logger.log(
          `Prisma connection re-established for funding reconciliation (attempt ${attempt}/${maxAttempts})`,
        );
        return true;
      } catch (reconnectError) {
        if (attempt === maxAttempts) {
          this.logger.error(
            'Prisma reconnect failed for funding reconciliation',
            reconnectError instanceof Error ? reconnectError.stack : String(reconnectError),
          );
          return false;
        }

        await this.sleep(baseDelayMs * attempt);
      }
    }

    return false;
  }

  private async sleep(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms <= 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, ms));
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
