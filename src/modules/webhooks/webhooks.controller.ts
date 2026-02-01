import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
  ) {}

  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // ✅ Hide from Swagger (external endpoint)
  @ApiOperation({ summary: 'Handle Flutterwave Webhook' })
  async handleFlutterwave(@Body() payload: any, @Headers('verif-hash') signature: string) {
    try {
      // 1. Verify Signature
      const secretHash = this.configService.get<string>('FLW_WEBHOOK_HASH');

      if (!secretHash) {
        this.logger.error('FLW_WEBHOOK_HASH not configured');
        throw new UnauthorizedException('Webhook configuration error');
      }

      if (!signature || signature !== secretHash) {
        this.logger.warn(`Invalid webhook signature. Received: ${signature}`);
        throw new UnauthorizedException('Invalid webhook signature');
      }

      // 2. Log incoming webhook
      this.logger.log(`Received Flutterwave webhook: ${payload.event} - ${payload.data?.id}`);

      // 3. Process
      await this.webhooksService.processFundingWebhook(payload);

      return { status: 'success', message: 'Webhook processed' };
    } catch (error) {
      this.logger.error(`Webhook processing failed: ${error.message}`, error.stack);

      // ✅ Still return 200 to prevent retries for validation errors
      if (error instanceof UnauthorizedException) {
        throw error; // Return 401
      }

      // Log error but return 200 (prevents Flutterwave retries)
      return {
        status: 'error',
        message: 'Webhook received but processing failed',
      };
    }
  }
}
