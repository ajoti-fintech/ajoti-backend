import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * Flutterwave webhook endpoint
   * This is the ONLY way funds are credited to wallets
   */
  @Post('flutterwave')
  @HttpCode(200)
  async handleFlutterwaveWebhook(
    @Body() payload: any,
    @Headers('verif-hash') verifHash: string,
  ) {
    await this.webhooksService.handleFlutterwaveWebhook(payload, verifHash);
    
    return {
      status: 'success',
      message: 'Webhook received',
    };
  }
}
