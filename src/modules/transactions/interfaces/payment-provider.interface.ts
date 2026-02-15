// src/modules/transaction/interfaces/payment-provider.interface.ts

export interface PaymentInitializationParams {
  tx_ref: string;
  amount: number; // Decimal Naira for provider
  currency: string;
  redirect_url: string;
  customer: {
    email: string;
    name?: string;
    phone_number?: string;
  };
  meta?: Record<string, any>;
}

export interface PaymentInitializationResponse {
  status: 'success' | 'error';
  message?: string;
  data?: {
    link: string; // The authorization URL
    [key: string]: any;
  };
  code?: string;
}

export interface WebhookVerificationResult {
  valid: boolean;
  payload?: any;
  reason?: string;
}

export interface PaymentVerificationResponse {
  status: 'success' | 'pending' | 'failed' | 'unknown';
  amount?: number;
  currency?: string;
  metadata?: any;
  message?: string;
}

export interface PaymentProvider {
  /**
   * Initialize a payment with the provider to get a checkout link
   */
  initializePayment(params: PaymentInitializationParams): Promise<PaymentInitializationResponse>;

  /**
   * Verify the provider's webhook signature using the raw request body
   */
  verifyWebhook(rawBody: string, signature: string): WebhookVerificationResult;

  /**
   * Direct API call to the provider to verify a transaction status
   */
  verifyTransaction(providerId: string): Promise<PaymentVerificationResponse>;

  getBalance(currency: string): Promise<{ balance: number; currency: string }>;
}
