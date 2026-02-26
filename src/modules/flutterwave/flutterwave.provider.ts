import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import * as crypto from 'crypto';

// ─── Request / Response Interfaces ───────────────────────────────────────────

export interface FlwInitiatePaymentPayload {
    tx_ref: string;
    amount: number; // Naira — FLW does NOT accept kobo
    currency: string;
    redirect_url: string;
    customer: {
        email: string;
        name?: string;
        phonenumber?: string;
    };
    payment_options?: string; // e.g. 'card,banktransfer,ussd'
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
        link: string; // Hosted checkout URL
    };
}

export interface FlwVerifyTransactionResponse {
    status: string;
    message: string;
    data: {
        id: number;
        tx_ref: string;
        flw_ref: string;
        amount: number; // Naira
        charged_amount: number;
        currency: string;
        status: 'successful' | 'failed' | 'pending';
        payment_type?: string;
        meta?: Record<string, unknown>;
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
    amount: number; // Naira — NOT kobo
    narration: string;
    currency: string;
    reference: string; // Must be unique — use WITHDRAWAL-{uuid}
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
        status: string;
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

export interface FlwCreateVirtualAccountPayload {
    email: string;
    is_permanent: boolean;
    bvn?: string;
    tx_ref: string; // Our stable reference — e.g. AJOTI-VA-{userId}
    currency: string;
    narration: string;
    firstname: string;
    lastname: string;
    phonenumber?: string;
    amount?: number; // Required only for non-permanent VAs
}

export interface FlwVirtualAccountData {
    response_code: string;
    response_message: string;
    flw_ref: string;
    order_ref: string;
    account_number: string;
    bank_name: string;
    account_name?: string;
    created_at: string;
    expiry_date: string;
    amount: number | null;
    frequency: string;
    is_active?: boolean;
    note?: string;
}

export interface FlwVirtualAccountResponse {
    status: string;
    message: string;
    data: FlwVirtualAccountData;
}

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * FlutterwaveProvider — canonical Flutterwave API client.
 *
 * This is the ONLY class that talks to the Flutterwave API.
 * All other modules (Funding, Withdrawal, Webhooks, VirtualAccount) import this.
 *
 * Modes:
 *  - TEST (default in development): uses _TEST keys, hits FLW sandbox
 *  - LIVE (production): uses _LIVE keys, real transactions
 *  - MOCK (MOCK_FLUTTERWAVE=true): returns deterministic fake responses — no HTTP calls
 *
 * Webhook verification:
 *  FLW sends the raw Secret Hash in the `verif-hash` header.
 *  We compare it with timing-safe equality (prevents timing-oracle attacks).
 *  Set BYPASS_WEBHOOK_VERIFICATION=true only for local dev with manual POST testing.
 */
@Injectable()
export class FlutterwaveProvider {
    private readonly logger = new Logger(FlutterwaveProvider.name);
    private readonly client: AxiosInstance;

    readonly isLive: boolean;
    readonly isMockMode: boolean;

    /** FLW's sandbox BVN — accepted for virtual account creation in test mode */
    readonly testBvn = '22222222222';

    private readonly webhookHash: string;
    private readonly bypassWebhookVerification: boolean;

    constructor(private readonly config: ConfigService) {
        const flw = this.config.get('flutterwave');

        this.isLive = flw.isLive;
        this.isMockMode = flw.mockMode;
        this.webhookHash = flw.webhookHash;
        this.bypassWebhookVerification = flw.bypassWebhookVerification;

        this.client = axios.create({
            baseURL: flw.baseUrl,
            headers: {
                Authorization: `Bearer ${flw.secretKey}`,
                'Content-Type': 'application/json',
            },
            timeout: 30_000,
        });

        this.logger.log(
            `FlutterwaveProvider ready [${this.isLive ? 'LIVE 🔴' : 'TEST 🟡'} mode]` +
            (this.isMockMode ? ' [MOCK — no real API calls]' : ''),
        );
    }

    // ─── Webhook Verification ──────────────────────────────────────────────────

    /**
     * Verify a Flutterwave webhook.
     *
     * FLW sends the Secret Hash you set in the dashboard verbatim inside
     * the `verif-hash` header on every webhook POST.  We compare with
     * crypto.timingSafeEqual to prevent timing-oracle attacks.
     *
     * Bypass is only available when BYPASS_WEBHOOK_VERIFICATION=true (dev only).
     */
    verifyWebhookSignature(signatureHeader: string): boolean {
        if (this.bypassWebhookVerification) {
            this.logger.warn(
                '⚠️  Webhook verification BYPASSED — only acceptable in local dev',
            );
            return true;
        }

        if (!signatureHeader || !this.webhookHash) return false;

        try {
            // Both buffers must be the same length for timingSafeEqual
            const received = Buffer.from(signatureHeader);
            const expected = Buffer.from(this.webhookHash);

            if (received.length !== expected.length) return false;

            return crypto.timingSafeEqual(received, expected);
        } catch {
            return false;
        }
    }

    // ─── Payments (Inflow — Hosted Checkout) ──────────────────────────────────

    /**
     * Initialise a hosted checkout session.
     * Returns a URL the user visits to complete payment.
     *
     * payment_options controls which channels FLW renders:
     *   'card,banktransfer,ussd' — all three for NGN
     *
     * Amount must be in Naira (divide kobo by 100 before calling this).
     */
    async initiatePayment(
        payload: FlwInitiatePaymentPayload,
    ): Promise<FlwInitiatePaymentResponse> {
        if (this.isMockMode) {
            this.logger.debug(`[MOCK] initiatePayment: tx_ref=${payload.tx_ref}`);
            return {
                status: 'success',
                message: 'Mock payment initiated',
                data: { link: `https://mock.flutterwave.com/pay/${payload.tx_ref}` },
            };
        }

        try {
            const { data } = await this.client.post<FlwInitiatePaymentResponse>(
                '/payments',
                payload,
            );
            return data;
        } catch (error) {
            this.logger.error('initiatePayment error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Verify a transaction by its Flutterwave numeric transaction ID.
     *
     * ALWAYS call this before crediting any wallet.
     * Cross-check: status === 'successful', tx_ref matches ours, currency === 'NGN'.
     */
    async verifyTransaction(
        transactionId: number,
    ): Promise<FlwVerifyTransactionResponse> {
        if (this.isMockMode) {
            return {
                status: 'success',
                message: 'Mock verification',
                data: {
                    id: transactionId,
                    tx_ref: `MOCK-${transactionId}`,
                    flw_ref: `FLW-MOCK-${transactionId}`,
                    amount: 1000,
                    charged_amount: 1000,
                    currency: 'NGN',
                    status: 'successful',
                    customer: { id: 0, name: 'Mock User', email: 'mock@test.com' },
                },
            };
        }

        try {
            const { data } = await this.client.get<FlwVerifyTransactionResponse>(
                `/transactions/${transactionId}/verify`,
            );
            return data;
        } catch (error) {
            this.logger.error(
                `verifyTransaction error: id=${transactionId}`,
                this.extractError(error),
            );
            throw error;
        }
    }

    // ─── Transfers (Outflow — Bank Withdrawals) ───────────────────────────────

    /**
     * Initiate a NGN bank transfer (withdrawal).
     * Amount must be in Naira — NOT kobo. Caller must divide by 100.
     * Reference must be unique — use WITHDRAWAL-{uuid}.
     */
    async initiateTransfer(
        payload: FlwTransferPayload,
    ): Promise<FlwTransferResponse> {
        if (this.isMockMode) {
            this.logger.debug(`[MOCK] initiateTransfer: ref=${payload.reference}`);
            return {
                status: 'success',
                message: 'Mock transfer initiated',
                data: {
                    id: Math.floor(Math.random() * 1_000_000),
                    account_number: payload.account_number,
                    bank_code: payload.account_bank,
                    full_name: payload.beneficiary_name ?? 'Mock Recipient',
                    created_at: new Date().toISOString(),
                    currency: payload.currency,
                    debit_currency: payload.debit_currency ?? 'NGN',
                    amount: payload.amount,
                    fee: 53.75,
                    status: 'NEW',
                    reference: payload.reference,
                    narration: payload.narration,
                    complete_message: '',
                    requires_approval: 0,
                    is_approved: 1,
                    bank_name: 'Mock Bank',
                },
            };
        }

        try {
            const { data } = await this.client.post<FlwTransferResponse>(
                '/transfers',
                payload,
            );
            return data;
        } catch (error) {
            this.logger.error('initiateTransfer error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Poll a transfer's current status by our internal reference.
     * Use this if the transfer.completed webhook is delayed.
     */
    async getTransferByReference(
        reference: string,
    ): Promise<FlwGetTransferResponse> {
        try {
            const { data } = await this.client.get<FlwGetTransferResponse>(
                '/transfers',
                { params: { reference } },
            );
            return data;
        } catch (error) {
            this.logger.error(
                `getTransferByReference error: ref=${reference}`,
                this.extractError(error),
            );
            throw error;
        }
    }

    // ─── Banks & Account Resolution ───────────────────────────────────────────

    /** Get list of supported banks for a country (default: NG). */
    async getBanks(country = 'NG'): Promise<FlwBankListResponse> {
        try {
            const { data } = await this.client.get<FlwBankListResponse>(
                `/banks/${country}`,
            );
            return data;
        } catch (error) {
            this.logger.error('getBanks error', this.extractError(error));
            throw error;
        }
    }

    /**
     * Resolve a bank account name.
     * Returns a normalised error object (not a throw) so callers can surface
     * FLW's user-safe message (e.g. "Invalid account number").
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
            this.logger.error('resolveAccountName error', this.extractError(error));
            if (error instanceof AxiosError && error.response) {
                return {
                    status: 'error',
                    message:
                        error.response.data?.message ?? 'Account resolution failed',
                    data: null,
                };
            }
            throw error;
        }
    }

    // ─── Virtual Accounts ─────────────────────────────────────────────────────

    /**
     * Create a permanent dedicated NGN virtual account for a user.
     *
     * Each user gets a unique Wema Bank account number.
     * Anyone who sends money to this account triggers a `charge.completed`
     * webhook with payment_type='bank_transfer' and tx_ref = our stable VA ref.
     *
     * BVN requirements:
     *   - Live mode: real BVN from approved KYC is mandatory
     *   - Test mode: uses FLW's sandbox BVN (22222222222) if no KYC BVN present
     *
     * Currency is always NGN for now (SRS: NGN only in scope).
     */
    async createVirtualAccount(
        payload: FlwCreateVirtualAccountPayload,
    ): Promise<FlwVirtualAccountResponse> {
        if (this.isMockMode) {
            this.logger.debug(`[MOCK] createVirtualAccount: tx_ref=${payload.tx_ref}`);
            return {
                status: 'success',
                message: 'Mock virtual account created',
                data: {
                    response_code: '02',
                    response_message: 'Transaction in progress',
                    flw_ref: `FLW-MOCK-VA-${Date.now()}`,
                    order_ref: `URF_MOCK_${Date.now()}`,
                    account_number: `990000${Math.floor(Math.random() * 10000)
                        .toString()
                        .padStart(4, '0')}`,
                    bank_name: 'WEMA BANK',
                    account_name: `${payload.firstname} ${payload.lastname}`,
                    created_at: new Date().toISOString(),
                    expiry_date: 'N/A',
                    amount: null,
                    frequency: 'N/A',
                    is_active: true,
                },
            };
        }

        try {
            const { data } = await this.client.post<FlwVirtualAccountResponse>(
                '/virtual-account-numbers',
                payload,
            );
            return data;
        } catch (error) {
            this.logger.error(
                'createVirtualAccount error',
                this.extractError(error),
            );
            throw error;
        }
    }

    /**
     * Fetch a virtual account's current details by its FLW order reference.
     */
    async getVirtualAccount(orderRef: string): Promise<FlwVirtualAccountResponse> {
        try {
            const { data } = await this.client.get<FlwVirtualAccountResponse>(
                `/virtual-account-numbers/${orderRef}`,
            );
            return data;
        } catch (error) {
            this.logger.error(
                `getVirtualAccount error: orderRef=${orderRef}`,
                this.extractError(error),
            );
            throw error;
        }
    }

    // ─── Utilities ───────────────────────────────────────────────────────────

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