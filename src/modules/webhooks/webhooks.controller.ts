// src/modules/webhooks/webhooks.controller.ts
import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { FlwWebhookPayload } from './dto/flutterwave-webhook.dto';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async handleFlutterwaveWebhook(
    @Headers('verif-hash') signature: string,
    @Body() rawPayload: Record<string, unknown>,
  ) {
    const payload = this.normalizePayload(rawPayload);
    this.logger.log(`Received FLW webhook: event=${payload?.event}`);
    return this.webhooksService.handleWebhook(payload, signature);
  }

  /**
   * Normalise webhook payloads to the internal shape used by WebhooksService.
   * Supports both:
   * - v3 style: { event, data, "event.type" }
   * - newer style: { type, data, id, timestamp }
   */
  private normalizePayload(rawPayload: Record<string, unknown>): FlwWebhookPayload {
    const rawEvent =
      typeof rawPayload?.event === 'string'
        ? rawPayload.event
        : typeof rawPayload?.type === 'string'
          ? rawPayload.type
          : null;

    const rawData = rawPayload?.data;
    if (!rawEvent || typeof rawData !== 'object' || rawData === null) {
      throw new BadRequestException('Invalid Flutterwave webhook payload');
    }

    const rawEventType = rawPayload['event.type'];
    const eventType =
      typeof rawEventType === 'string'
        ? rawEventType
        : typeof rawPayload?.type === 'string'
          ? rawPayload.type
          : undefined;

    const rawMetaData = rawPayload?.meta_data;
    const metaData =
      rawMetaData && typeof rawMetaData === 'object'
        ? (rawMetaData as Record<string, unknown>)
        : undefined;

    return {
      event: rawEvent,
      'event.type': eventType,
      data: rawData as FlwWebhookPayload['data'],
      meta_data: metaData,
    };
  }
}
