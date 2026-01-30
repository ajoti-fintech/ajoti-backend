import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { TransactionsService } from '../transactions/transactions.service';
import { EntryType, Category, TransactionStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * Handle Flutterwave webhook
   * CRITICAL: This is the authoritative source for wallet credits
   *
   * Flow:
   * 1. Verify signature
   * 2. Check idempotency
   * 3. Validate event type
   * 4. Credit wallet via ledger
   * 5. Update transaction status
   */
  async handleFlutterwaveWebhook(payload: any, verifHash: string): Promise<void> {
    try {
      // 1. Verify webhook signature
      this.verifyFlutterwaveSignature(payload, verifHash);

      // 2. Extract event data
      const eventType = payload.event;
      const eventId = payload.id || payload.txRef;

      if (!eventId) {
        throw new BadRequestException('Missing event ID');
      }

      // 3. Check idempotency (prevent duplicate processing)
      const isDuplicate = await this.checkIdempotency('FLUTTERWAVE', eventId);
      if (isDuplicate) {
        this.logger.warn(`Duplicate webhook event: ${eventId}`);
        return;
      }

      // 4. Process based on event type
      if (eventType === 'charge.completed') {
        await this.processFundingWebhook(payload, eventId);
      } else if (eventType === 'transfer.completed') {
        await this.processWithdrawalWebhook(payload, eventId);
      } else {
        this.logger.warn(`Unhandled event type: ${eventType}`);
      }

      // 5. Record webhook event (after successful processing)
      await this.recordWebhookEvent('FLUTTERWAVE', eventId, payload);
    } catch (error) {
      this.logger.error('Webhook processing failed', error);
      throw error;
    }
  }

  /**
   * Process funding webhook (credit wallet)
   */
  private async processFundingWebhook(payload: any, eventId: string): Promise<void> {
    const { tx_ref: txRef, amount, currency, status } = payload.data;

    if (status !== 'successful') {
      this.logger.warn(`Non-successful charge: ${txRef}, status: ${status}`);
      return;
    }

    if (currency !== 'NGN') {
      throw new BadRequestException('Only NGN currency supported');
    }

    // Convert amount to kobo (smallest unit)
    const amountInKobo = BigInt(Math.round(amount * 100));

    // Get transaction record
    const transaction = await this.transactionsService.getTransactionByReference(txRef);
    if (!transaction) {
      throw new BadRequestException(`Transaction not found: ${txRef}`);
    }

    // ATOMIC: Credit wallet via ledger
    await this.ledgerService.writeEntry({
      walletId: transaction.walletId,
      entryType: EntryType.CREDIT,
      category: Category.FUNDING,
      amount: amountInKobo,
      reference: txRef,
      metadata: {
        provider: 'FLUTTERWAVE',
        eventId,
        rawPayload: payload,
      },
    });

    // Update transaction status
    await this.transactionsService.updateTransactionStatus(
      txRef,
      TransactionStatus.SUCCESS,
      payload,
    );

    this.logger.log(`Wallet credited: ${txRef}, amount: ${amountInKobo} kobo`);
  }

  /**
   * Process withdrawal webhook (confirm transfer)
   */
  private async processWithdrawalWebhook(payload: any, eventId: string): Promise<void> {
    const { reference, status } = payload.data;

    // Get transaction record
    const transaction = await this.transactionsService.getTransactionByReference(reference);
    if (!transaction) {
      throw new BadRequestException(`Transaction not found: ${reference}`);
    }

    if (status === 'successful') {
      // Update transaction status to SUCCESS
      await this.transactionsService.updateTransactionStatus(
        reference,
        TransactionStatus.SUCCESS,
        payload,
      );
      this.logger.log(`Withdrawal confirmed: ${reference}`);
    } else if (status === 'failed') {
      // Create reversal entry to restore funds
      const originalLedgerEntry = await this.prisma.ledgerEntry.findUnique({
        where: { reference },
      });

      if (originalLedgerEntry) {
        await this.ledgerService.createReversalEntry(originalLedgerEntry.id, 'Withdrawal failed');
      }

      // Update transaction status to FAILED
      await this.transactionsService.updateTransactionStatus(
        reference,
        TransactionStatus.FAILED,
        payload,
      );
      this.logger.warn(`Withdrawal failed: ${reference}`);
    }
  }

  /**
   * Verify Flutterwave webhook signature
   */
  private verifyFlutterwaveSignature(payload: any, verifHash: string): void {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;

    if (!secretHash) {
      throw new Error('FLUTTERWAVE_SECRET_HASH not configured');
    }

    // Flutterwave sends the hash in the verif-hash header
    if (verifHash !== secretHash) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  /**
   * Check if webhook event has already been processed
   */
  private async checkIdempotency(provider: string, eventId: string): Promise<boolean> {
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    return !!existing;
  }

  /**
   * Record webhook event for audit trail
   */
  private async recordWebhookEvent(provider: string, eventId: string, payload: any): Promise<void> {
    await this.prisma.webhookEvent.create({
      data: {
        provider,
        eventId,
        payload,
      },
    });
  }
}
