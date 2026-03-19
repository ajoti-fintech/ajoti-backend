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
import { FlutterwaveWebhookDto, FlwWebhookPayload } from './dto/flutterwave-webhook.dto';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async handleFlutterwaveWebhook(
    @Headers('verif-hash') signature: string,
    @Body() payload: FlwWebhookPayload,
  ) {
    this.logger.log(`Received FLW webhook: event=${payload?.event}`);
    return this.webhooksService.handleWebhook(payload, signature);
  }
}
