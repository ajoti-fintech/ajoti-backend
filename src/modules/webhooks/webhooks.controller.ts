// src/modules/webhooks/webhooks.controller.ts
import {
  Controller,
  Post,
  Headers,
  Req,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { WebhooksService } from './webhooks.service';
import { FlutterwaveWebhookDto } from './dto/flutterwave-webhook.dto';
import { FlutterwaveService } from '../transactions/flutterwave.service';
import { TransactionsService } from '../transactions/transactions.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly transactionsService: TransactionsService,
    private readonly flutterwave: FlutterwaveService,
  ) {}

  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handleFlutterwave(
    @Headers('verif-hash') signature: string,
    @Req() req: RequestWithRawBody,
    @Body() payload: FlutterwaveWebhookDto,
  ) {
    const txRef = payload.data?.tx_ref || 'unknown';
    this.logger.log(`Flutterwave webhook: ${payload.event} / ${txRef}`);

    try {
      if (!signature) throw new BadRequestException('Missing verif-hash header');

      if (!req.rawBody) throw new Error('Raw body missing - check main.ts');

      const rawBodyStr = req.rawBody.toString('utf8');
      const verification = this.flutterwave.verifyWebhook(rawBodyStr, signature);

      if (!verification.valid) {
        this.logger.warn(`Invalid signature for ${txRef}`);
        return { status: 'ignored', reason: 'signature_mismatch' };
      }

      // Record webhook first (idempotency)
      const webhookRecord = await this.webhooksService.recordWebhook(
        'FLUTTERWAVE',
        payload.data.id,
        payload,
      );

      if (!webhookRecord) {
        return { status: 'already_processed' };
      }

      // Route to appropriate handler
      if (payload.event === 'charge.completed') {
        if (payload.data.status === 'successful') {
          await this.transactionsService.finalizeSettlement({
            reference: payload.data.tx_ref, // Mapping tx_ref to reference
            providerId: String(payload.data.id), // Mapping id to providerId
            receivedAmountNaira: payload.data.amount, // Mapping amount to receivedAmountNaira
            providerName: 'FLUTTERWAVE',
            webhookPayload: payload, // Passing the full payload for audit
          });
        } else {
          await this.transactionsService.markAsFailed(
            payload.data.tx_ref,
            `Payment failed: ${payload.data.status || 'unknown reason'}`,
          );
        }
      } else {
        this.logger.warn(`Unhandled event: ${payload.event}`);
      }

      return { status: 'success' };
    } catch (error: any) {
      this.logger.error(`Webhook error for ${txRef}`, error.stack);
      return { status: 'error', message: 'Received' };
    }
  }
}
