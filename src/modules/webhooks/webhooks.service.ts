import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { TransactionsService } from '../transactions/transactions.service';
import { FlutterwaveService } from '../transactions/flutterwave.service';
import {
  TransactionStatus,
  LedgerSourceType,
  EntryType,
  MovementType,
  BucketType,
} from '@prisma/client';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly transactionsService: TransactionsService,
    private readonly flutterwaveService: FlutterwaveService,
  ) {}

  /**
   * Process Flutterwave Funding Webhook
   * Refactored to use LedgerService.writeEntry with a single argument.
   */
  async processFundingWebhook(payload: any): Promise<void> {
    const eventType = payload.event;

    if (eventType !== 'charge.completed') {
      this.logger.warn(`Ignoring non-funding event: ${eventType}`);
      return;
    }

    const { tx_ref, status, amount, id: flwId } = payload.data;

    // 1. Idempotency Check using WebhookEvent table
    const existingEvent = await this.prisma.webhookEvent.findUnique({
      where: { eventId: flwId.toString() },
    });

    if (existingEvent) {
      this.logger.warn(`Webhook event ${flwId} already processed. Skipping.`);
      return;
    }

    // 2. Find local transaction record
    const transaction = await this.transactionsService.findByProviderRef(tx_ref);
    if (!transaction) {
      throw new BadRequestException(`Transaction with ref ${tx_ref} not found`);
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      this.logger.warn(`Transaction ${tx_ref} already in status ${transaction.status}`);
      return;
    }

    const verification = await this.flutterwaveService.verifyTransaction(flwId.toString());

    if (
      verification.status !== 'success' ||
      verification.data.status !== 'successful' ||
      verification.data.amount < amount // Safety check against amount tampering
    ) {
      this.logger.error(`Fraud/Status Mismatch detected for transaction ${tx_ref}`);

      await this.transactionsService.updateTransactionStatus(
        transaction.id,
        TransactionStatus.FAILED,
        { reason: 'Verification failed: Status mismatch or amount discrepancy' },
      );
      return;
    }

    // 3. Process Success Path
    if (status === 'successful') {
      // Using a standard Prisma transaction to wrap all operations
      await this.prisma.$transaction(async (tx) => {
        // A. Record the Webhook Event for idempotency
        await tx.webhookEvent.create({
          data: {
            provider: 'FLUTTERWAVE',
            eventId: flwId.toString(),
            payload: payload,
          },
        });

        // B. Credit the Wallet via LedgerService
        // Passing only 1 argument to writeEntry as per your requirement
        await this.ledgerService.writeEntry(
          {
            walletId: transaction.walletId,
            amount: BigInt(Math.round(amount * 100)), // Convert Naira to Kobo
            entryType: EntryType.CREDIT,
            movementType: MovementType.FUNDING,
            bucketType: BucketType.MAIN,
            sourceType: LedgerSourceType.TRANSACTION,
            sourceId: transaction.id,
            reference: `FLW-${flwId}`,
            metadata: { description: `Funding via Flutterwave: ${tx_ref}` },
          },
          tx,
        );

        // C. Mark Transaction as Success
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            status: TransactionStatus.SUCCESS,
            updatedAt: new Date(),
          },
        });
      });

      this.logger.log(`Successfully funded wallet ${transaction.walletId} with ${amount}`);
    } else {
      // Handle failed/cancelled status
      await this.transactionsService.updateTransactionStatus(
        transaction.id,
        TransactionStatus.FAILED,
        { reason: 'Provider reported failure', raw: payload.data },
      );
    }
  }
}
