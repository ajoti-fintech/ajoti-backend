import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly baseUrl: string = 'https://developersandbox-api.flutterwave.com'; // Sandbox for v4
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const clientId = this.configService.get<string>('FLW_CLIENT_ID')!;
      const clientSecret = this.configService.get<string>('FLW_CLIENT_SECRET')!;

      if (!clientId || !clientSecret) {
        throw new Error('Missing FLW_CLIENT_ID or FLW_CLIENT_SECRET');
      }

      const response = await lastValueFrom(
        this.httpService.post(
          'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        ),
      );

      const { access_token, expires_in } = response.data;
      this.accessToken = access_token;
      this.tokenExpiry = now + expires_in * 1000 - 60000; // Refresh 1 min early

      this.logger.log('Flutterwave v4 access token refreshed');
      return access_token;
    } catch (error: any) {
      this.logger.error(
        'Failed to get Flutterwave v4 token',
        error.response?.data || error.message,
      );
      throw new InternalServerErrorException('Flutterwave authentication failed');
    }
  }

  private async getAuthHeaders() {
    const token = await this.getAccessToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  async verifyTransaction(transactionId: string) {
    try {
      this.logger.debug(`Verifying transaction ${transactionId} with Flutterwave v4...`);

      const headers = await this.getAuthHeaders();
      const response = await lastValueFrom(
        this.httpService.get(`${this.baseUrl}/transactions/${transactionId}/verify`, {
          headers,
        }),
      );

      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message;
      this.logger.error(`Verification failed: ${errorMsg}`);
      throw new InternalServerErrorException(`Transaction verification failed: ${errorMsg}`);
    }
  }

  async getBalance(currency: string = 'NGN') {
    try {
      this.logger.debug(`Fetching balance for ${currency} with Flutterwave v4...`);

      const headers = await this.getAuthHeaders();
      // v4 balance endpoint (all or specific via query/filter; docs show /wallets/balances)
      const response = await lastValueFrom(
        this.httpService.get(`${this.baseUrl}/wallets/balances/${currency}`, {
          headers,
        }),
      );

      return response.data;
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message;
      this.logger.error(`Balance fetch failed: ${errorMsg}`);
      throw new InternalServerErrorException(`Failed to fetch balance: ${errorMsg}`);
    }
  }
}
