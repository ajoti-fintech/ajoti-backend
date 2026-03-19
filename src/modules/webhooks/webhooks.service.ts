// src/modules/webhooks/webhooks.service.ts
import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BucketType,
  EntryType,
  LedgerSourceType,
  MovementType,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '@/prisma';
import { LedgerService } from '../ledger/ledger.service';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';
import {
  FlwChargeData,
  FlwTransferData,
  FlwWebhookPayload,
} from './dto/flutterwave-webhook.dto';

/**
 * FINANCIAL RULES (non-negotiable):
 *
 * R0  Ledger is append-only — no updates, no deletes
 * R1  Wallet credited ONLY via confirmed webhook (charge.completed, successful)
 * R2  Idempotency check (webhook_events.event_id UNIQUE) BEFORE any processing
 * R3  Always verify with FLW API before crediting — never trust webhook payload alone
 * R4  All multi-step DB operations inside prisma.$transaction()
 * R5  Failed transfers → compensating CREDIT reversal entry, never touch original DEBIT
 * R6  Amount conversion: FLW sends Naira → store kobo (multiply × 100)
 *
 * Virtual account payments (VA):
 * R7  VA payments reuse tx_ref (AJOTI-VA-{userId}) — idempotency key is flw_ref (unique per payment)
 * R8  VA credits create a Transaction record inline (no pre-existing PENDING record)
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flw: FlutterwaveProvider,
    private readonly ledger: LedgerService,
  ) {}

  // ─── Entry Point ──────────────────────────────────────────────────────────

  async handleWebhook(
    payload: FlwWebhookPayload,
    signatureHeader: string,
  ): Promise<{ received: boolean }> {
    // R1: Verify signature first — reject anything unsigned
    if (!this.flw.verifyWebhookSignature(signatureHeader)) {
      this.logger.warn('Rejected webhook — invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // R2: Idempotency — deduplicate FLW retries before any side effects
    const eventId = this.extractEventId(payload);
    const alreadyProcessed = await this.checkIdempotency(eventId, payload);
    if (alreadyProcessed) {
      this.logger.log(`Duplicate webhook ignored: ${eventId}`);
      return { received: true }; // 200 OK — do nothing
    }

    // Route to handler
    try {
      if (payload.event === 'charge.completed') {
        const data = payload.data as FlwChargeData;
        if (this.isVirtualAccountPayment(data)) {
          await this.handleVirtualAccountCredit(data);
        } else {
          await this.handleChargeCompleted(data);
        }
      } else if (payload.event === 'transfer.completed') {
        await this.handleTransferCompleted(payload.data as FlwTransferData);
      } else {
        this.logger.log(`Unhandled webhook event: ${payload.event} — ignoring`);
      }
    } catch (error) {
      // Always return 200 to prevent FLW retrying indefinitely.
      // The idempotency key is already committed, so re-delivery would be ignored anyway.
      // Log for manual reprocessing.
      this.logger.error(`Webhook handler error for ${eventId}`, error);
    }

    return { received: true };
  }

  // ─── Routing Helpers ──────────────────────────────────────────────────────

  /**
   * Determine if a charge.completed event is a virtual account payment.
   * VA payments: payment_type='bank_transfer' AND tx_ref starts with 'AJOTI-VA-'
   */
  private isVirtualAccountPayment(data: FlwChargeData): boolean {
    return (
      (data as any).payment_type === 'bank_transfer' &&
      typeof data.tx_ref === 'string' &&
      data.tx_ref.startsWith('AJOTI-VA-')
    );
  }

  /**
   * Build the idempotency event ID.
   *
   * For standard payments: "charge.completed::{tx_ref}" (tx_ref is unique per checkout session)
   * For VA payments:       "charge.completed::{flw_ref}" (tx_ref is REUSED — flw_ref is unique)
   * For transfers:         "transfer.completed::{reference}"
   */
  private extractEventId(payload: FlwWebhookPayload): string {
    const data = payload.data as any;

    // R7: VA payments — must use flw_ref for idempotency, not tx_ref
    if (
      data.payment_type === 'bank_transfer' &&
      data.tx_ref?.startsWith('AJOTI-VA-')
    ) {
      return `${payload.event}::${data.flw_ref}`;
    }

    const ref = data.tx_ref ?? data.reference ?? String(data.id);
    return `${payload.event}::${ref}`;
  }

  // ─── charge.completed → Hosted Checkout Funding ───────────────────────────

  /**
   * Handle a successful hosted checkout payment (card, USSD, bank transfer).
   *
   * Flow:
   *  1. Skip if not successful
   *  2. R3: Verify with FLW API
   *  3. Find the PENDING transaction by tx_ref
   *  4. R6: Convert Naira → kobo
   *  5. Write CREDIT ledger entry via LedgerService (handles FOR UPDATE internally)
   *  6. Mark transaction SUCCESS
   */
  private async handleChargeCompleted(data: FlwChargeData): Promise<void> {
    this.logger.log(
      `charge.completed: tx_ref=${data.tx_ref}, status=${data.status}`,
    );

    if (data.status !== 'successful') {
      this.logger.log(`Charge not successful (${data.status}) — marking FAILED`);
      await this.updateTransactionStatus(data.tx_ref, TransactionStatus.FAILED);
      return;
    }

    // R3: Verify before crediting
    const verifyResult = await this.flw.verifyTransaction(data.id);
    const verified =
      verifyResult.data?.status === 'successful' &&
      verifyResult.data.tx_ref === data.tx_ref &&
      verifyResult.data.currency === 'NGN';

    if (!verified) {
      this.logger.warn(
        `Verification mismatch for tx_ref=${data.tx_ref} — marking FAILED`,
      );
      await this.updateTransactionStatus(data.tx_ref, TransactionStatus.FAILED);
      return;
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: data.tx_ref },
      include: { wallet: true },
    });

    if (!transaction) {
      this.logger.error(`No transaction record for tx_ref=${data.tx_ref}`);
      return;
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      this.logger.warn(
        `Transaction ${data.tx_ref} already ${transaction.status} — skipping`,
      );
      return;
    }

    // R6: FLW sends Naira — convert to kobo
    const amountKobo = BigInt(Math.round(data.amount * 100));

    await this.prisma.$transaction(async (tx) => {
      // R0: Append-only credit via LedgerService (handles SELECT FOR UPDATE internally)
      await this.ledger.writeEntry(
        {
          walletId: transaction.walletId,
          entryType: EntryType.CREDIT,
          movementType: MovementType.FUNDING,
          bucketType: BucketType.MAIN,
          amount: amountKobo,
          reference: `FUNDING-${transaction.id}`,
          sourceType: LedgerSourceType.TRANSACTION,
          sourceId: transaction.id,
          metadata: {
            flwTransactionId: data.id,
            flwRef: data.flw_ref,
            provider: 'FLUTTERWAVE',
            paymentType: (data as any).payment_type ?? 'unknown',
          },
        },
        tx,
      );

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          completedAt: new Date(),
          metadata: {
            ...((transaction.metadata as object) ?? {}),
            flwTransactionId: data.id,
            flwRef: data.flw_ref,
            chargedAmount: data.charged_amount,
          },
        },
      });
    });

    this.logger.log(
      `Wallet funded: walletId=${transaction.walletId}, amount=${amountKobo} kobo`,
    );
  }

  // ─── charge.completed → Virtual Account Credit ────────────────────────────

  /**
   * Handle an incoming payment to a user's dedicated virtual account.
   *
   * Differences from standard hosted checkout:
   *  - No pre-existing PENDING transaction — we create one inline (R8)
   *  - Idempotency is keyed on flw_ref (unique per payment), not tx_ref (static per VA)
   *  - userId is extracted from the stable tx_ref (AJOTI-VA-{userId})
   *
   * Flow:
   *  1. Skip if not successful
   *  2. R3: Verify with FLW API
   *  3. Look up virtual account + wallet by tx_ref
   *  4. Create Transaction record (PENDING → SUCCESS inline)
   *  5. Write CREDIT ledger entry
   */
  private async handleVirtualAccountCredit(data: FlwChargeData): Promise<void> {
    const flwRef = (data as any).flw_ref as string;
    this.logger.log(
      `VA credit: tx_ref=${data.tx_ref}, flw_ref=${flwRef}, amount=${data.amount} NGN`,
    );

    if (data.status !== 'successful') {
      this.logger.log(`VA payment not successful (${data.status}) — skipping`);
      return;
    }

    // R3: Verify before crediting
    const verifyResult = await this.flw.verifyTransaction(data.id);
    if (verifyResult.data?.status !== 'successful') {
      this.logger.warn(
        `VA verification failed: flw_ref=${flwRef}, reported status=${verifyResult.data?.status}`,
      );
      return;
    }

    // Look up VA and wallet
    const virtualAccount = await this.prisma.virtualAccount.findUnique({
      where: { txRef: data.tx_ref },
      include: { wallet: true },
    });

    if (!virtualAccount) {
      this.logger.error(`No virtual account for tx_ref=${data.tx_ref}`);
      return;
    }

    if (!virtualAccount.isActive) {
      this.logger.warn(`Virtual account inactive: tx_ref=${data.tx_ref}`);
      return;
    }

    // R6: Naira → kobo
    const amountKobo = BigInt(Math.round(data.amount * 100));
    const transactionRef = `VA-CREDIT-${flwRef}`;

    await this.prisma.$transaction(async (tx) => {
      // R8: Create Transaction record inline — no pre-existing PENDING record for VA payments
      const transaction = await tx.transaction.create({
        data: {
          walletId: virtualAccount.walletId,
          provider: 'FLUTTERWAVE',
          reference: transactionRef,
          amount: amountKobo,
          currency: 'NGN',
          status: TransactionStatus.SUCCESS,
          type: TransactionType.FUNDING,
          completedAt: new Date(),
          metadata: {
            flwTransactionId: data.id,
            flwRef,
            paymentType: 'virtual_account',
            virtualAccountNumber: virtualAccount.accountNumber,
            bankName: virtualAccount.bankName,
          },
        },
      });

      // R0: Append-only credit
      await this.ledger.writeEntry(
        {
          walletId: virtualAccount.walletId,
          entryType: EntryType.CREDIT,
          movementType: MovementType.FUNDING,
          bucketType: BucketType.MAIN,
          amount: amountKobo,
          reference: `VA-FUNDING-${transaction.id}`,
          sourceType: LedgerSourceType.TRANSACTION,
          sourceId: transaction.id,
          metadata: {
            flwTransactionId: data.id,
            flwRef,
            paymentType: 'virtual_account',
            provider: 'FLUTTERWAVE',
            virtualAccountNumber: virtualAccount.accountNumber,
          },
        },
        tx,
      );
    });

    this.logger.log(
      `VA wallet funded: walletId=${virtualAccount.walletId}, ` +
        `amount=${amountKobo} kobo, flwRef=${flwRef}`,
    );
  }

  // ─── transfer.completed → Withdrawal Confirmation ─────────────────────────

  /**
   * Handle a transfer.completed event (withdrawal outcome).
   *
   * SUCCESS: Mark transaction as SUCCESS (ledger DEBIT already written at initiation)
   * FAILED:  R5 — create compensating CREDIT reversal entry, mark transaction FAILED
   *
   * Original DEBIT entry is never touched (R0 — append-only).
   */
  private async handleTransferCompleted(data: FlwTransferData): Promise<void> {
    this.logger.log(
      `transfer.completed: reference=${data.reference}, status=${data.status}`,
    );

    const transaction = await this.prisma.transaction.findUnique({
      where: { reference: data.reference },
      include: { wallet: true },
    });

    if (!transaction) {
      this.logger.error(
        `No transaction record for transfer ref=${data.reference}`,
      );
      return;
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      this.logger.warn(
        `Transfer ${data.reference} already ${transaction.status} — skipping`,
      );
      return;
    }

    const isSuccessful = data.status === 'SUCCESSFUL';

    await this.prisma.$transaction(async (tx) => {
      if (isSuccessful) {
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.SUCCESS,
            completedAt: new Date(),
            metadata: {
              ...((transaction.metadata as object) ?? {}),
              flwTransferId: data.id,
              completeMessage: data.complete_message,
            },
          },
        });
        this.logger.log(
          `Withdrawal confirmed: walletId=${transaction.walletId}, ref=${data.reference}`,
        );
      } else {
        // R5: Transfer failed — compensating credit (funds return to user's available balance)
        const reversalRef = `REVERSAL-${transaction.reference}`;

        await this.ledger.writeEntry(
          {
            walletId: transaction.walletId,
            entryType: EntryType.CREDIT,
            movementType: MovementType.WITHDRAWAL,
            bucketType: BucketType.MAIN,
            amount: transaction.amount, // Already in kobo
            reference: reversalRef,
            sourceType: LedgerSourceType.REVERSAL,
            sourceId: transaction.id,
            metadata: {
              reason: 'Transfer failed at Flutterwave',
              flwTransferId: data.id,
              completeMessage: data.complete_message,
              originalRef: transaction.reference,
            },
          },
          tx,
        );

        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.FAILED,
            metadata: {
              ...((transaction.metadata as object) ?? {}),
              flwTransferId: data.id,
              failureReason: data.complete_message,
              reversalRef,
            },
          },
        });

        this.logger.warn(
          `Withdrawal FAILED — reversal credited: walletId=${transaction.walletId}, ref=${reversalRef}`,
        );
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Record a webhook event for idempotency.
   * Returns true if already processed (duplicate — caller should skip).
   * Uses the UNIQUE constraint on webhook_events.event_id as the gate.
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
      return false; // New — proceed with processing
    } catch (error: any) {
      if (error?.code === 'P2002') return true; // Duplicate — skip
      throw error;
    }
  }

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