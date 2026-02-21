import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import * as crypto from 'crypto';

export interface FlwInitiatePaymentPayload {
    tx_ref: string;
    amount: number; // NGN (naira, NOT kobo — FLW takes naira)
    currency: string;
    redirect_url: string;
    customer: {
        email: string;
        name: string;
        phonenumber?: string;
    };
    payment_options?: string;
    meta?: Record<string, unknown>;
    customizations?: {
        title?: string;
        description?: string;
        logo?: string;
    };
}

export interface FlwInitiatePaymentResponse {
    status: string;
    message: string;
    data: {
        link: string; // checkout URL
    };
}

export interface FlwVerifyTransactionResponse {
    status: string;
    message: string;
    data: {
        id: number;
        tx_ref: string;
        flw_ref: string;
        amount: number;
        currency: string;
        charged_amount: number;
        status: 'successful' | 'failed' | 'pending';
        customer: {
            id: number;
            name: string;
            email: string;
        };
    };
}

export interface FlwTransferPayload {
    account_bank: string;
    account_number: string;
    amount: number; // NGN (naira, NOT kobo)
    narration: string;
    currency: string;
    reference: string;
    callback_url?: string;
    debit_currency?: string;
    beneficiary_name?: string;
}

export interface FlwTransferResponse {
    status: string;
    message: string;
    data: {
        id: number;
        account_number: string;
        bank_code: string;
        full_name: string;
        created_at: string;
        currency: string;
        debit_currency: string;
        amount: number;
        fee: number;
        status: string; // NEW | PENDING | FAILED | SUCCESSFUL
        reference: string;
        narration: string;
        complete_message: string;
        requires_approval: number;
        is_approved: number;
        bank_name: string;
    };
}

export interface FlwGetTransferResponse {
    status: string;
    message: string;
    data: {
        id: number;
        status: string; // NEW | PENDING | FAILED | SUCCESSFUL
        reference: string;
        complete_message: string;
        amount: number;
        fee: number;
        currency: string;
        bank_name: string;
        account_number: string;
        full_name: string;
    };
}

export interface FlwBankListResponse {
    status: string;
    message: string;
    data: Array<{
        id: number;
        code: string;
        name: string;
    }>;
}

export interface FlwAccountResolveResponse {
    status: string;
    message: string;
    data: {
        account_number: string;
        account_name: string;
    } | null;
}

@Injectable()
export class FlutterwaveProvider {
    private readonly logger = new Logger(FlutterwaveProvider.name);
    private readonly client: AxiosInstance;
    private readonly secretKey: string;
    private readonly webhookHash: string;

    constructor(private readonly configService: ConfigService) {
        this.secretKey = this.configService.getOrThrow<string>('FLW_SECRET_KEY');
        this.webhookHash = this.configService.getOrThrow<string>('FLW_WEBHOOK_HASH');

        this.client = axios.create({
            baseURL: 'https://api.flutterwave.com/v3',
            headers: {
                Authorization: `Bearer ${this.secretKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 30_000, // 30s - FLW can timeout at 28s
        });
    }

    /**
     * Verify a Flutterwave webhook signature.
     * FLW sends the secret hash in the `verif-hash` header.
     * We compare it to FLW_WEBHOOK_HASH env variable.
     */
    verifyWebhookSignature(signatureHeader: string): boolean {
        if (!signatureHeader) return false;
        // Constant-time comparison to prevent timing attacks
        try {
            return crypto.timingSafeEqual(
                Buffer.from(signatureHeader),
                Buffer.from(this.webhookHash),
            );
        } catch {
            return false;
        }
    }

    /**
     * Initialize a payment and get a hosted checkout URL.
     * Used by the funding module.
     * NOTE: FLW takes amount in NAIRA, not kobo. Caller must convert.
     */
    async initiatePayment(
        payload: FlwInitiatePaymentPayload,
    ): Promise<FlwInitiatePaymentResponse> {
        try {
            const { data } = await this.client.post<FlwInitiatePaymentResponse>(
                '/payments',
                payload,
            );
            return data;
        } catch (error) {
            this.logger.error('FLW initiatePayment error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Verify a transaction by its Flutterwave transaction ID.
     * Always verify before crediting the customer.
     */
    async verifyTransaction(
        transactionId: number,
    ): Promise<FlwVerifyTransactionResponse> {
        try {
            const { data } = await this.client.get<FlwVerifyTransactionResponse>(
                `/transactions/${transactionId}/verify`,
            );
            return data;
        } catch (error) {
            this.logger.error('FLW verifyTransaction error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Initiate a bank transfer (withdrawal).
     * NOTE: FLW takes amount in NAIRA, not kobo. Caller must convert.
     * Reference must be unique — use WITHDRAWAL-{uuid} pattern.
     */
    async initiateTransfer(payload: FlwTransferPayload): Promise<FlwTransferResponse> {
        try {
            const { data } = await this.client.post<FlwTransferResponse>(
                '/transfers',
                payload,
            );
            return data;
        } catch (error) {
            this.logger.error('FLW initiateTransfer error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Fetch the current status of a transfer by its internal reference.
     * Use this to poll for a transfer's status if webhook is delayed.
     */
    async getTransferByReference(reference: string): Promise<FlwGetTransferResponse> {
        try {
            const { data } = await this.client.get<FlwGetTransferResponse>('/transfers', {
                params: { reference },
            });
            return data;
        } catch (error) {
            this.logger.error('FLW getTransfer error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Get list of Nigerian banks.
     * Used by GET /api/wallet/banks
     */
    async getBanks(country: string = 'NG'): Promise<FlwBankListResponse> {
        try {
            const { data } = await this.client.get<FlwBankListResponse>(
                `/banks/${country}`,
            );
            return data;
        } catch (error) {
            this.logger.error('FLW getBanks error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Resolve a bank account name.
     * Endpoint: POST /accounts/resolve
     * Used by POST /api/wallet/bank/verify
     */
    async resolveAccountName(
        accountNumber: string,
        accountBank: string,
    ): Promise<FlwAccountResolveResponse> {
        try {
            const { data } = await this.client.post<FlwAccountResolveResponse>(
                '/accounts/resolve',
                { account_number: accountNumber, account_bank: accountBank },
            );
            return data;
        } catch (error) {
            this.logger.error('FLW resolveAccount error', this.extractError(error));
            // Don't rethrow — return a normalized error response
            if (error instanceof AxiosError && error.response) {
                return {
                    status: 'error',
                    message: error.response.data?.message ?? 'Account resolution failed',
                    data: null,
                };
            }
            throw error;
        }
    }

    private extractError(error: unknown): string {
        if (error instanceof AxiosError) {
            return JSON.stringify({
                status: error.response?.status,
                data: error.response?.data,
                message: error.message,
            });
        }
        return String(error);
    }
}