import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  EntryType,
  LedgerSourceType,
  MovementType,
  TransactionStatus,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '@/prisma';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';
import { FlwWebhookPayload, FlwTransferData, FlwChargeData } from './dto/flutterwave-webhook.dto';

/**
 * CRITICAL FINANCIAL RULES (from DDD):
 * 1. Check webhook_events.event_id UNIQUE before processing — idempotency
 * 2. All ledger writes are APPEND-ONLY — no updates, no deletes
 * 3. All multi-step operations use prisma.$transaction()
 * 4. On failure after debit: create REVERSAL compensating CREDIT entry
 * 5. Amount conversion: FLW sends Naira → we store Kobo (multiply by 100)
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly flw: FlutterwaveProvider,
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
      return { received: true }; // 200 OK — do nothing
    }

    // 3. Route to handler
    try {
      if (payload.event === 'charge.completed') {
        await this.handleChargeCompleted(payload.data as FlwChargeData);
      } else if (payload.event === 'transfer.completed') {
        await this.handleTransferCompleted(payload.data as FlwTransferData);
      } else {
        this.logger.log(`Unhandled webhook event: ${payload.event} — ignoring`);
      }
    } catch (error) {
      this.logger.error(`Webhook processing failed for event ${eventId}`, error);
      // We still return 200 to prevent FLW from retrying infinitely.
      // The error is logged and can be re-processed manually.
      // Per DDD: webhook idempotency key is already committed above.
    }

    return { received: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // charge.completed → FUNDING confirmation
  // ─────────────────────────────────────────────────────────────────────────

  private async handleChargeCompleted(data: FlwChargeData): Promise<void> {
    this.logger.log(
      `Processing charge.completed: tx_ref=${data.tx_ref}, status=${data.status}`,
    );

    // Only credit on successful payments
    if (data.status !== 'successful') {
      this.logger.log(`Charge not successful (${data.status}) — skipping credit`);
      await this.updateTransactionStatus(data.tx_ref, TransactionStatus.FAILED);
      return;
    }

    // Verify with FLW before crediting (per FLW best practice)
    let verified: boolean;
    try {
      const verifyResult = await this.flw.verifyTransaction(data.id);
      verified =
        verifyResult.data.status === 'successful' &&
        verifyResult.data.tx_ref === data.tx_ref &&
        verifyResult.data.currency === 'NGN';
    } catch (error) {
      this.logger.error(`Transaction verification failed for ${data.tx_ref}`, error);
      throw error;
    }

    if (!verified) {
      this.logger.warn(`Transaction verification mismatch for ${data.tx_ref}`);
      await this.updateTransactionStatus(data.tx_ref, TransactionStatus.FAILED);
      return;
    }

    // Find the pending transaction
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

    // Amount: FLW sends Naira, we store Kobo
    const amountKobo = BigInt(Math.round(data.amount * 100));

    // Atomic: compute balance, write ledger, update transaction
    await this.prisma.$transaction(async (tx) => {
      // Pessimistic lock on wallet row
      await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${transaction.walletId} FOR UPDATE`;

      // Compute current balance from ledger
      const balanceSums = await tx.ledgerEntry.aggregate({
        where: { walletId: transaction.walletId },
        _sum: { amount: true },
        // We can't aggregate by entryType in Prisma easily, so we compute manually below
      });

      const { credit, debit } = await this.computeBalance(tx, transaction.walletId);
      const balanceBefore = credit - debit;
      const balanceAfter = balanceBefore + amountKobo;

      // Append-only ledger CREDIT entry
      await tx.ledgerEntry.create({
        data: {
          walletId: transaction.walletId,
          reference: `FUNDING-${transaction.id}`,
          entryType: EntryType.CREDIT,
          movementType: MovementType.FUNDING,
          amount: amountKobo,
          balanceBefore,
          balanceAfter,
          sourceType: LedgerSourceType.TRANSACTION,
          sourceId: transaction.id,
          metadata: {
            flwTransactionId: data.id,
            flwRef: data.flw_ref,
            provider: 'FLUTTERWAVE',
          },
        },
      });

      // Update transaction to SUCCESS
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: TransactionStatus.SUCCESS,
          completedAt: new Date(),
          metadata: {
            ...(transaction.metadata as object),
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
        // Transfer was successful — just mark the transaction as done
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
        // Transfer FAILED — create compensating CREDIT reversal entry
        // Per DDD: "On failure: create CREDIT reversal entry (ref: REVERSAL-{originalRef})"
        await tx.$executeRaw`SELECT id FROM wallets WHERE id = ${transaction.walletId} FOR UPDATE`;

        const { credit, debit } = await this.computeBalance(tx, transaction.walletId);
        const balanceBefore = credit - debit;
        const reversalAmount = transaction.amount; // already in kobo
        const balanceAfter = balanceBefore + reversalAmount;

        const reversalRef = `REVERSAL-${transaction.reference}`;

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

        // Mark transaction as FAILED
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
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

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
      return false; // New event
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // Prisma unique constraint violation — duplicate
        return true;
      }
      throw error;
    }
  }

  /**
   * Extract a unique event ID from the payload.
   * We compose it from event type + data reference to ensure uniqueness
   * even if FLW retries with slightly different timestamps.
   */
  private extractEventId(payload: FlwWebhookPayload): string {
    const data = payload.data as any;
    // charge.completed uses tx_ref, transfer.completed uses reference
    const ref = data.tx_ref ?? data.reference ?? data.id;
    return `${payload.event}::${ref}`;
  }

  /**
   * Compute current wallet balance from ledger.
   * Returns { credit, debit } in kobo.
   * Caller is responsible for holding FOR UPDATE lock.
   */
  private async computeBalance(
    tx: any,
    walletId: string,
  ): Promise<{ credit: bigint; debit: bigint }> {
    const entries = await tx.ledgerEntry.findMany({
      where: { walletId },
      select: { entryType: true, amount: true },
    });

    let credit = BigInt(0);
    let debit = BigInt(0);

    for (const entry of entries) {
      if (entry.entryType === EntryType.CREDIT) {
        credit += entry.amount;
      } else if (entry.entryType === EntryType.DEBIT) {
        debit += entry.amount;
      }
    }

    return { credit, debit };
  }

  /**
   * Update transaction status for cases where we don't need
   * a ledger entry (e.g. charge failed before we debited anything).
   */
  private async updateTransactionStatus(
    txRef: string,
    status: TransactionStatus,
  ): Promise<void> {
    await this.prisma.transaction.updateMany({
      where: { reference: txRef, status: TransactionStatus.PENDING },
      data: { status, completedAt: status === TransactionStatus.SUCCESS ? new Date() : undefined },
    });
  }
}