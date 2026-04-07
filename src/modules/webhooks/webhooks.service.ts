// src/modules/webhooks/webhooks.service.ts
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EntryType,
  LedgerSourceType,
  MovementType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@/prisma';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';
import {
  FlwWebhookPayload,
  FlwTransferData,
  FlwChargeData,
  FlwWebhookMetaData,
} from './dto/flutterwave-webhook.dto';
import { AUTH_EVENTS_QUEUE, AuthJobName } from '../auth/auth.events';

/**
 * CRITICAL FINANCIAL RULES (from DDD):
 * 1. Check webhook_events.event_id UNIQUE before processing — idempotency
 * 2. All ledger writes are APPEND-ONLY — no updates, no deletes
 * 3. All multi-step operations use prisma.$transaction()
 * 4. On failure after debit: create REVERSAL compensating CREDIT entry
 * 5. Amount conversion: FLW sends Naira → we store Kobo (multiply by 100)
 *
 * VA CREDIT IDEMPOTENCY (important):
 * - Virtual accounts have a STATIC tx_ref (AJOTI-VA-{userId}) reused on every payment
 * - We use flw_ref (unique per FLW transaction) as the ledger reference for VA credits
 * - This is enforced by the LedgerEntry unique constraint: (walletId, reference, sourceType, sourceId)
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flw: FlutterwaveProvider,
    @InjectQueue(AUTH_EVENTS_QUEUE) private readonly authEventsQueue: Queue,
  ) {}

  /**
   * Entry point for all Flutterwave webhooks.
   * Routes to the appropriate handler based on event type.
   */
  async handleWebhook(
    payload: FlwWebhookPayload,
    signatureHeader: string,
  ): Promise<{ received: boolean }> {
    // 1. Verify webhook signature
    if (!this.flw.verifyWebhookSignature(signatureHeader)) {
      this.logger.warn('Invalid webhook signature received');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const eventId = this.extractEventId(payload);

    // 2. Idempotency check — deduplicate retried webhooks
    const alreadyProcessed = await this.checkIdempotency(eventId, payload);
    if (alreadyProcessed) {
      this.logger.log(`Duplicate webhook ignored: ${eventId}`);
      return { received: true };
    }

    // 3. Route to handler
    try {
      if (payload.event === 'charge.completed') {
        await this.handleChargeCompleted(payload);
      } else if (payload.event === 'transfer.completed') {
        await this.handleTransferCompleted(payload.data as FlwTransferData);
      } else {
        this.logger.log(`Unhandled webhook event: ${payload.event} — ignoring`);
      }
    } catch (error) {
      this.logger.error(`Webhook processing failed for event ${eventId}`, error);
      // Release idempotency marker so retries can be processed.
      // This prevents permanent fund-loss scenarios if processing fails transiently.
      await this.releaseIdempotencyMarker(eventId);
      throw error;
    }

    return { received: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // charge.completed — two paths:
  //   A) Virtual Account credit  (tx_ref = AJOTI-VA-{userId}, static per user)
  //   B) Hosted checkout funding (tx_ref = AJT-FUND-{uuid}, unique per session)
  // ─────────────────────────────────────────────────────────────────────────

  private async handleChargeCompleted(payload: FlwWebhookPayload): Promise<void> {
    const data = payload.data as FlwChargeData;

    this.logger.log(
      `Processing charge.completed: tx_ref=${data.tx_ref}, status=${data.status}, payment_type=${data.payment_type}`,
    );

    if (data.status !== 'successful') {
      this.logger.log(`Charge not successful (${data.status}) — skipping credit`);
      // Only mark failed if a Transaction record exists (hosted checkout path)
      await this.updateTransactionStatus(data.tx_ref, TransactionStatus.FAILED);
      return;
    }

    // ── PATH A: Virtual Account ───────────────────────────────────────────
    // VA tx_ref is stable (AJOTI-VA-{userId}), so we look it up in virtual_accounts.
    // We must handle this BEFORE the Transaction lookup because there is no
    // Transaction row for VA payments — the VA is provisioned once, not per payment.
    const normalizedPaymentType = data.payment_type?.toLowerCase().trim();
    const isBankTransferCharge =
      normalizedPaymentType === 'bank_transfer' ||
      normalizedPaymentType === 'banktransfer' ||
      payload['event.type'] === 'BANK_TRANSFER_TRANSACTION';

    if (isBankTransferCharge) {
      const va = await this.prisma.virtualAccount.findUnique({
        where: { txRef: data.tx_ref },
        include: { wallet: true },
      });

      if (va) {
        const verification = await this.verifyChargeWithProvider(data);
        if (!verification.valid) {
          this.logger.warn(
            `VA verification mismatch for tx_ref=${data.tx_ref}: ${verification.reason}`,
          );
          return;
        }

        const credited = await this.creditWalletFromVA(
          va,
          data,
          verification.amountKobo,
          payload.meta_data,
        );
        if (credited) {
          await this.enqueueTransactionEvent(
            va.userId,
            'CREDIT',
            verification.amountKobo,
            `VA-${data.flw_ref}`,
          );
        }
        return;
      }
      // No VA found for this tx_ref — fall through to hosted checkout path.
      // This handles bank_transfer payments made via the standard hosted checkout.
    }

    // ── PATH B: Hosted Checkout (card / ussd / one-time bank_transfer) ────
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: data.tx_ref },
      include: { wallet: true },
    });

    if (!transaction) {
      this.logger.error(`Transaction not found for tx_ref: ${data.tx_ref}`);
      return;
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      this.logger.warn(
        `Transaction ${data.tx_ref} already in status ${transaction.status} — skipping`,
      );
      return;
    }

    // Verify with FLW before crediting (status, tx_ref, currency, amount).
    const verification = await this.verifyChargeWithProvider(data, transaction.amount);
    if (!verification.valid) {
      this.logger.warn(
        `Transaction verification mismatch for ${data.tx_ref}: ${verification.reason}`,
      );
      await this.updateTransactionStatus(data.tx_ref, TransactionStatus.FAILED);
      return;
    }

    const amountKobo = verification.amountKobo;
    const settledPaymentType = verification.paymentType ?? data.payment_type;
    const fundingMethodLabel = this.resolveFundingMethodLabel(settledPaymentType);
    const fundingTransactionType = this.resolveFundingTransactionType(settledPaymentType);
    const fundingReference = `${fundingMethodLabel}-${transaction.id}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${transaction.walletId} FOR UPDATE`;

      // Use running total from balanceAfter — O(1) vs O(n) full scan
      const balanceBefore = await this.getLatestBalance(tx, transaction.walletId);
      const balanceAfter = balanceBefore + amountKobo;

      await tx.ledgerEntry.create({
        data: {
          walletId: transaction.walletId,
          reference: fundingReference,
          entryType: EntryType.CREDIT,
          movementType: MovementType.FUNDING,
          amount: amountKobo,
          balanceBefore,
          balanceAfter,
          sourceType: LedgerSourceType.TRANSACTION,
          sourceId: transaction.id,
          metadata: {
            flwTransactionId: data.id,
            flwRef: verification.flwRef,
            provider: 'FLUTTERWAVE',
            paymentType: settledPaymentType ?? 'unknown',
            verifiedAmountKobo: amountKobo.toString(),
            fundingMethodLabel,
          },
        },
      });

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          type: fundingTransactionType,
          status: TransactionStatus.SUCCESS,
          completedAt: new Date(),
          metadata: {
            ...(transaction.metadata as object),
            flwTransactionId: data.id,
            flwRef: verification.flwRef,
            verifiedPaymentType: settledPaymentType ?? null,
            chargedAmount: verification.chargedAmount,
            verifiedAmountKobo: amountKobo.toString(),
            fundingMethodLabel,
            fundingLedgerReference: fundingReference,
          },
        },
      });
    });

    this.logger.log(
      `Hosted checkout funded: walletId=${transaction.walletId}, amount=${amountKobo} kobo`,
    );

    await this.enqueueTransactionEvent(
      transaction.wallet.userId,
      'CREDIT',
      amountKobo,
      fundingReference,
    );
  }

  /**
   * Credit a wallet from a Virtual Account payment.
   *
   * KEY DIFFERENCE FROM HOSTED CHECKOUT:
   * - tx_ref is STATIC (reused for every payment to the same VA)
   * - flw_ref is UNIQUE per payment — used as the ledger reference for idempotency
   * - The LedgerEntry unique constraint (walletId, reference, sourceType, sourceId)
   *   prevents double-credits if FLW retries the webhook
   * - No Transaction record exists — VA credits go straight to the ledger
   */
  private async creditWalletFromVA(
    va: any,
    data: FlwChargeData,
    amountKobo: bigint,
    webhookMetaData?: FlwWebhookMetaData,
  ): Promise<boolean> {
    this.logger.log(
      `VA credit: userId=${va.userId}, flw_ref=${data.flw_ref}, amount=${amountKobo.toString()} kobo`,
    );

    // flw_ref is unique per FLW transaction — safe idempotency key for VA payments
    const ledgerReference = `VA-${data.flw_ref}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${va.walletId} FOR UPDATE`;

      // Check for duplicate using the LedgerEntry reference.
      // This is a belt-and-suspenders guard on top of the idempotency key in webhook_events.
      const existing = await tx.ledgerEntry.findFirst({
        where: {
          walletId: va.walletId,
          reference: ledgerReference,
        },
      });

      if (existing) {
        this.logger.warn(
          `Duplicate VA ledger entry detected for flw_ref=${data.flw_ref} — skipping`,
        );
        return false;
      }

      // Use running total — O(1)
      const balanceBefore = await this.getLatestBalance(tx, va.walletId);
      const balanceAfter = balanceBefore + amountKobo;

      await tx.ledgerEntry.create({
        data: {
          walletId: va.walletId,
          // flw_ref as reference = unique per payment, prevents double-credit
          reference: ledgerReference,
          entryType: EntryType.CREDIT,
          movementType: MovementType.FUNDING,
          amount: amountKobo,
          balanceBefore,
          balanceAfter,
          // sourceId = virtualAccount.id (stable per user — not per payment)
          sourceType: LedgerSourceType.TRANSACTION,
          sourceId: va.id,
          metadata: {
            flwTransactionId: data.id,
            flwRef: data.flw_ref,
            txRef: data.tx_ref,
            provider: 'FLUTTERWAVE',
            source: 'VIRTUAL_ACCOUNT',
            senderName: (data as any).sender ?? null,
            originatorAccountNumber:
              webhookMetaData?.originatoraccountnumber ?? null,
            originatorName: webhookMetaData?.originatorname ?? null,
            originatorBankName: webhookMetaData?.bankname ?? null,
            originatorAmount: webhookMetaData?.originatoramount ?? null,
            providerMetaData: (webhookMetaData as any) ?? null,
          },
        },
      });
    });

    this.logger.log(
      `VA wallet funded: walletId=${va.walletId}, amount=${amountKobo} kobo, flw_ref=${data.flw_ref}`,
    );

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // transfer.completed → WITHDRAWAL confirmation or REVERSAL
  // ─────────────────────────────────────────────────────────────────────────

  private async handleTransferCompleted(data: FlwTransferData): Promise<void> {
    this.logger.log(
      `Processing transfer.completed: reference=${data.reference}, status=${data.status}`,
    );

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: data.reference },
      include: { wallet: true },
    });

    if (!transaction) {
      this.logger.error(`Transaction not found for transfer ref: ${data.reference}`);
      return;
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      this.logger.warn(
        `Transfer ${data.reference} already in status ${transaction.status} — skipping`,
      );
      return;
    }

    const isSuccessful = data.status === 'SUCCESSFUL';

    await this.prisma.$transaction(async (tx) => {
      if (isSuccessful) {
        // Transfer confirmed — just mark the transaction done.
        // The ledger DEBIT was already written at initiation time (WithdrawalService).
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.SUCCESS,
            completedAt: new Date(),
            metadata: {
              ...(transaction.metadata as object),
              flwTransferId: data.id,
              completeMessage: data.complete_message,
            },
          },
        });

        this.logger.log(
          `Withdrawal confirmed: walletId=${transaction.walletId}, ref=${data.reference}`,
        );
      } else {
        // Transfer FAILED — compensating CREDIT reversal.
        // The original DEBIT in the ledger stays (append-only). We add a matching CREDIT.
        await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${transaction.walletId} FOR UPDATE`;

        const reversalAmount = transaction.amount; // already in kobo
        const reversalRef = `REVERSAL-${transaction.reference}`;

        const balanceBefore = await this.getLatestBalance(tx, transaction.walletId);
        const balanceAfter = balanceBefore + reversalAmount;

        await tx.ledgerEntry.create({
          data: {
            walletId: transaction.walletId,
            reference: reversalRef,
            entryType: EntryType.CREDIT,
            movementType: MovementType.WITHDRAWAL,
            amount: reversalAmount,
            balanceBefore,
            balanceAfter,
            sourceType: LedgerSourceType.REVERSAL,
            sourceId: transaction.id,
            metadata: {
              reason: 'Transfer failed at provider',
              flwTransferId: data.id,
              completeMessage: data.complete_message,
              originalRef: transaction.reference,
            },
          },
        });

        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            metadata: {
              ...(transaction.metadata as object),
              flwTransferId: data.id,
              failureReason: data.complete_message,
              reversalRef,
            },
          },
        });

        this.logger.warn(
          `Withdrawal failed — reversal credited: walletId=${transaction.walletId}, ref=${reversalRef}`,
        );
      }
    });

    // Emit notification AFTER the DB transaction commits.
    if (isSuccessful) {
      await this.enqueueTransactionEvent(
        transaction.wallet.userId,
        'DEBIT',
        transaction.amount,
        transaction.reference,
      );
    } else {
      // Withdrawal failed — funds were returned; notify as a CREDIT refund.
      await this.enqueueTransactionEvent(
        transaction.wallet.userId,
        'CREDIT',
        transaction.amount,
        `REVERSAL-${transaction.reference}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the current total wallet balance from the running total (balanceAfter).
   *
   * O(1) — reads only the most recent ledger entry.
   * This is the correct approach vs. summing all entries which is O(n).
   *
   * The caller must hold a SELECT FOR UPDATE lock on the wallet row
   * before calling this to prevent race conditions.
   */
  private async getLatestBalance(tx: any, walletId: string): Promise<bigint> {
    const last = await tx.ledgerEntry.findFirst({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      select: { balanceAfter: true },
    });
    return last?.balanceAfter ?? 0n;
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

  /**
   * Provider-side charge verification guard.
   * Flutterwave docs recommend verifying tx status + tx_ref + currency + amount
   * before giving value.
   */
  private async verifyChargeWithProvider(
    data: FlwChargeData,
    expectedAmountKobo?: bigint,
  ): Promise<{
    valid: boolean;
    amountKobo: bigint;
    flwRef: string;
    paymentType?: string;
    chargedAmount: number;
    reason?: string;
  }> {
    const verifyResult = await this.flw.verifyTransaction(data.id);
    const verified = verifyResult.data;

    if (verified.status !== 'successful') {
      return {
        valid: false,
        amountKobo: 0n,
        flwRef: verified.flw_ref ?? data.flw_ref,
        paymentType: verified.payment_type,
        chargedAmount: verified.charged_amount,
        reason: 'provider_status_not_successful',
      };
    }

    if (verified.tx_ref !== data.tx_ref) {
      return {
        valid: false,
        amountKobo: 0n,
        flwRef: verified.flw_ref ?? data.flw_ref,
        paymentType: verified.payment_type,
        chargedAmount: verified.charged_amount,
        reason: 'tx_ref_mismatch',
      };
    }

    if (verified.currency !== 'NGN') {
      return {
        valid: false,
        amountKobo: 0n,
        flwRef: verified.flw_ref ?? data.flw_ref,
        paymentType: verified.payment_type,
        chargedAmount: verified.charged_amount,
        reason: 'currency_mismatch',
      };
    }

    const verifiedAmountKobo = BigInt(Math.round(verified.amount * 100));
    if (expectedAmountKobo !== undefined && verifiedAmountKobo !== expectedAmountKobo) {
      return {
        valid: false,
        amountKobo: verifiedAmountKobo,
        flwRef: verified.flw_ref ?? data.flw_ref,
        paymentType: verified.payment_type,
        chargedAmount: verified.charged_amount,
        reason: `amount_mismatch_expected_${expectedAmountKobo.toString()}_got_${verifiedAmountKobo.toString()}`,
      };
    }

    // We trust the verified endpoint values over webhook payload values.
    const webhookAmountKobo = BigInt(Math.round(data.amount * 100));
    if (webhookAmountKobo !== verifiedAmountKobo) {
      this.logger.warn(
        `Webhook amount differs from verified amount for tx_ref=${data.tx_ref}: webhook=${webhookAmountKobo.toString()}, verified=${verifiedAmountKobo.toString()}`,
      );
    }

    return {
      valid: true,
      amountKobo: verifiedAmountKobo,
      flwRef: verified.flw_ref ?? data.flw_ref,
      paymentType: verified.payment_type,
      chargedAmount: verified.charged_amount,
    };
  }

  /**
   * Record the webhook event BEFORE processing.
   * Uses UNIQUE constraint on event_id to prevent duplicates.
   * Returns true if already processed (duplicate).
   */
  private async checkIdempotency(
    eventId: string,
    payload: FlwWebhookPayload,
  ): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'FLUTTERWAVE',
          eventId,
          payload: payload as object,
        },
      });
      return false;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return true; // Duplicate
      }
      throw error;
    }
  }

  /**
   * Remove idempotency marker when processing fails so provider retries can succeed.
   */
  private async releaseIdempotencyMarker(eventId: string): Promise<void> {
    try {
      await this.prisma.webhookEvent.delete({
        where: { eventId },
      });
    } catch (error: any) {
      // Ignore "record not found" and bubble everything else.
      if (error?.code !== 'P2025') {
        throw error;
      }
    }
  }

  /**
   * Extract a unique event ID from the payload.
   *
   * charge.completed:  event::tx_ref::flw_ref  (flw_ref makes it unique per payment)
   * transfer.completed: event::reference
   *
   * Including flw_ref for charge events is important because tx_ref is STATIC
   * for virtual accounts (reused on every payment to the same account).
   */
  private extractEventId(payload: FlwWebhookPayload): string {
    const data = payload.data as any;

    if (payload.event === 'charge.completed') {
      // flw_ref is unique per FLW transaction — guarantees uniqueness for VA payments
      const flwRef = data.flw_ref ?? data.id;
      return `${payload.event}::${data.tx_ref}::${flwRef}`;
    }

    // transfer.completed — reference is our unique internal ref
    const ref = data.reference ?? data.id;
    return `${payload.event}::${ref}`;
  }

  /**
   * Enqueue a wallet.transaction.completed notification event.
   * Fetches user email + fullName then fires the job on the auth-events queue.
   * Called AFTER the DB transaction commits to guarantee consistency.
   */
  private async enqueueTransactionEvent(
    userId: string,
    type: 'CREDIT' | 'DEBIT',
    amountKobo: bigint,
    reference: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, firstName: true, lastName: true },
      });

      if (!user) return;

      await this.authEventsQueue.add(
        AuthJobName.WALLET_TRANSACTION_COMPLETED,
        {
          userId,
          email: user.email,
          fullName: `${user.firstName} ${user.lastName}`,
          type,
          amount: Number(amountKobo) / 100, // kobo → NGN
          currency: 'NGN',
          reference,
          timestamp: new Date().toISOString(),
        },
        { removeOnComplete: true, attempts: 3 },
      );
    } catch (err) {
      // Notification failure must never roll back a completed financial transaction.
      this.logger.error(`Failed to enqueue transaction notification for userId=${userId}`, err);
    }
  }

  /**
   * Update transaction status for cases where we don't need a ledger entry
   * (e.g. charge failed before we debited anything).
   * Uses updateMany so it silently does nothing if no matching PENDING record exists.
   */
  private async updateTransactionStatus(
    txRef: string,
    status: TransactionStatus,
  ): Promise<void> {
    await this.prisma.transaction.updateMany({
      where: { reference: txRef, status: TransactionStatus.PENDING },
      data: {
        status,
        completedAt: status === TransactionStatus.SUCCESS ? new Date() : undefined,
      },
    });
  }
}
