// src/modules/transaction/flutterwave.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createHmac } from 'crypto';
import {
  PaymentProvider,
  PaymentInitializationParams,
  PaymentInitializationResponse,
  WebhookVerificationResult,
  PaymentVerificationResponse,
} from './interfaces/payment-provider.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FlutterwaveService implements PaymentProvider {
  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly baseUrl = 'https://api.flutterwave.com/v3';
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(
    private http: HttpService,
    private readonly config: ConfigService,
  ) {
    const isDev = this.config.get('NODE_ENV') !== 'production';

    // 2. INITIALIZE ALL: Using mock values for Dev/Test
    this.publicKey = this.config.get<string>('FLW_PUBLIC_KEY') || (isDev ? 'dev_pk' : '');
    this.secretKey = this.config.get<string>('FLW_SECRET_KEY') || (isDev ? 'dev_sk' : '');
    this.webhookSecret = this.config.get<string>('FLW_SECRET_HASH') || (isDev ? 'dev_hash' : '');

    if (!this.publicKey || !this.secretKey) {
      this.logger.warn('Flutterwave credentials missing - running in Mock Mode');
      if (!isDev) throw new Error('Flutterwave credentials not configured');
    }
  }

  async initializePayment(
    params: PaymentInitializationParams,
  ): Promise<PaymentInitializationResponse> {
    const txRef = params.tx_ref;
    try {
      const payload = {
        tx_ref: txRef,
        amount: params.amount,
        currency: params.currency,
        redirect_url: params.redirect_url,
        customer: params.customer,
        meta: params.meta,
        payment_options: 'card,banktransfer,ussd',
      };

      const response = await firstValueFrom(
        this.http.post(`${this.baseUrl}/payments`, payload, {
          headers: { Authorization: `Bearer ${this.secretKey}` },
          timeout: 20000,
        }),
      );

      return { status: 'success', data: response.data.data };
    } catch (error: any) {
      this.logger.error(`Flutterwave init failed for ${txRef}`, error.stack);
      return { status: 'error', message: error.response?.data?.message || 'Network error' };
    }
  }

  verifyWebhook(rawBody: string, signature: string): WebhookVerificationResult {
    try {
      const computedHash = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
      if (computedHash === signature) {
        return { valid: true, payload: JSON.parse(rawBody) };
      }
      return { valid: false, reason: 'HMAC mismatch' };
    } catch (error) {
      return { valid: false, reason: 'Verification failed' };
    }
  }

  async verifyTransaction(providerId: string): Promise<PaymentVerificationResponse> {
    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/transactions/${providerId}/verify`, {
          headers: { Authorization: `Bearer ${this.secretKey}` },
          timeout: 10000,
        }),
      );

      const flwStatus = response.data.data.status.toLowerCase();
      return {
        status: flwStatus.includes('successful')
          ? 'success'
          : flwStatus.includes('pending')
            ? 'pending'
            : 'failed',
        amount: response.data.data.amount,
        currency: response.data.data.currency,
        metadata: response.data.data.meta,
      };
    } catch (error: any) {
      return { status: 'unknown', message: error.message };
    }
  }

  async getBalance(currency: string = 'NGN'): Promise<{ balance: number; currency: string }> {
    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/balances/${currency}`, {
          headers: { Authorization: `Bearer ${this.secretKey}` },
          timeout: 10000,
        }),
      );

      const data = response.data;

      if (data.status === 'success') {
        return {
          balance: data.data.available_balance,
          currency: data.data.currency,
        };
      }

      throw new Error(data.message || 'Failed to fetch provider balance');
    } catch (error: any) {
      this.logger.error(`Failed to fetch Flutterwave balance for ${currency}`, error.stack);
      throw new Error('Provider balance check failed');
    }
  }
}
