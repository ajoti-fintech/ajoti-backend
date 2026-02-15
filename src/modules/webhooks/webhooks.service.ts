// src/modules/webhooks/webhooks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  /**
   * Records the webhook for idempotency.
   * Note: This is now a standalone helper, but TransactionsService.finalizeSettlement
   * also handles its own idempotency check internally for atomicity.
   */
  async recordWebhook(
    provider: string,
    eventId: string | number,
    payload: unknown,
    txClient?: Prisma.TransactionClient,
  ) {
    const db = txClient || this.prisma;
    const eventIdStr = String(eventId);

    try {
      return await db.webhookEvent.create({
        data: {
          provider,
          eventId: eventIdStr,
          payload: payload as Prisma.InputJsonValue,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') return null; // Duplicate
      throw error;
    }
  }

  /**
   * DRY Router: Purely directs traffic to TransactionsService.
   */
  async processFundingWebhook(payload: any): Promise<void> {
    const { event, data } = payload;

    if (event === 'charge.completed') {
      if (data.status === 'successful') {
        // Direct route to the new generic settlement logic
        await this.transactionsService.finalizeSettlement({
          reference: data.tx_ref,
          providerId: String(data.id),
          receivedAmountNaira: data.amount,
          providerName: 'FLUTTERWAVE',
          webhookPayload: payload,
        });
      } else {
        // Handle failed/cancelled charges
        await this.transactionsService.markAsFailed(
          data.tx_ref,
          `Provider reported status: ${data.status}`,
        );
      }
    } else {
      this.logger.warn(`Unhandled event type: ${event}`);
    }
  }
}
