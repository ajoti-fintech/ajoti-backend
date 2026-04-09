// src/modules/funding/funding.service.ts
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { AxiosError } from 'axios';
import { WalletService } from '../wallet/wallet.service';
import { InitializeFundingDto } from './dto/funding.dto';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { TransactionsService } from '../transactions/transactions.service';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';
import {
  FundingReconciliationScheduler,
  ManualFundingReconcileResult,
} from './funding-reconciliation.scheduler';
import { PrismaService } from '../../prisma';

@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly transactionsService: TransactionsService,
    private readonly flw: FlutterwaveProvider,
    private readonly prisma: PrismaService,
    private readonly fundingReconciliationScheduler: FundingReconciliationScheduler,
  ) {}

  /**
   * Initialize a hosted checkout funding session.
   *
   * Flow:
   *  1. Validate wallet is ACTIVE
   *  2. Generate unique tx_ref
   *  3. Create PENDING transaction record
   *  4. Call FLW /payments to get a checkout URL
   *  5. Return the URL — NO ledger write here
   *
   * The wallet is only credited when FLW fires the charge.completed webhook.
   */
  async initialize(userId: string, dto: InitializeFundingDto) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    if (wallet.status !== 'ACTIVE') {
      throw new BadRequestException('Wallet is not active');
    }

    const reference = `AJT-FUND-${crypto.randomUUID()}`;
    const initializedAt = new Date().toISOString();

    // Record the intent — PENDING until webhook confirms
    const transaction = await this.transactionsService.create({
      walletId: wallet.id,
      amount: BigInt(dto.amount),
      reference,
      type: TransactionType.FUNDING,
      status: TransactionStatus.PENDING,
      currency: dto.currency ?? 'NGN',
      provider: 'FLUTTERWAVE',
      metadata: {
        ...(dto.metadata ?? {}),
        source: 'HOSTED_CHECKOUT',
        initializedAt,
        redirectUrl: dto.redirectUrl,
      } as Prisma.InputJsonValue,
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // Call FLW — amount must be Naira (dto.amount is kobo)
    let providerResponse;
    try {
      providerResponse = await this.flw.initiatePayment({
        tx_ref: reference,
        amount: Number(dto.amount) / 100,
        currency: dto.currency ?? 'NGN',
        redirect_url: dto.redirectUrl,
        customer: {
          email: user?.email ?? `user-${userId}@ajoti.com`,
          name: user ? `${user.firstName} ${user.lastName}`.trim() : undefined,
          phonenumber: user?.phone ?? undefined,
        },
        // Let checkout UI handle method selection (card, bank transfer, ussd).
        payment_options: 'card,banktransfer,ussd',
        meta: {
          transactionId: transaction.id,
          walletId: wallet.id,
          userId,
        },
        customizations: {
          title: 'Ajoti Wallet Top-up',
          description: `Fund your Ajoti wallet — ₦${(Number(dto.amount) / 100).toLocaleString('en-NG')}`,
        },
      });
    } catch (error: unknown) {
      const providerMessage = this.extractProviderMessage(error);
      this.logger.error(
        `FLW payment initialization threw for ref=${reference}: ${providerMessage}`,
      );
      await this.transactionsService.markAsFailed(reference, providerMessage);
      throw new BadRequestException('Payment provider unavailable. Please try again.');
    }

    if (providerResponse.status !== 'success' || !providerResponse.data?.link) {
      this.logger.error('FLW payment initialization failed', providerResponse);
      // Mark transaction failed so it doesn't sit pending forever
      await this.transactionsService.markAsFailed(
        reference,
        providerResponse.message ?? 'Provider returned empty response',
      );
      throw new BadRequestException(
        providerResponse.message ?? 'Payment provider unavailable. Please try again.',
      );
    }

    try {
      await this.fundingReconciliationScheduler.scheduleInitialVerification(reference);
    } catch (error) {
      this.logger.warn(
        `Funding background verification could not be queued for ref=${reference}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      reference,
      authorizationUrl: providerResponse.data.link,
      provider: 'FLUTTERWAVE',
    };
  }

  /** UI helper — returns available funding channels with display metadata. */
  async getFundingMethods() {
    return [
      {
        id: 'CARD',
        name: 'Debit / Credit Card',
        icon: 'credit-card',
        fee: 0,
        minAmount: 10000, // 100 NGN in kobo
        description: 'Instant. Visa, Mastercard, Verve.',
      },
      {
        id: 'BANK_TRANSFER',
        name: 'Bank Transfer',
        icon: 'bank',
        fee: 0,
        minAmount: 10000,
        description: 'Transfer from any Nigerian bank. May take a few minutes.',
      },
      {
        id: 'USSD',
        name: 'USSD',
        icon: 'phone',
        fee: 0,
        minAmount: 10000,
        description: "Use your bank's USSD code. No internet required.",
      },
    ];
  }

  /**
   * Called by the frontend immediately after Flutterwave redirects the user back.
   * Verifies the payment with Flutterwave on-demand and credits the wallet if successful.
   * Ownership is enforced — users can only verify their own transactions.
   */
  async verifyFunding(
    userId: string,
    reference: string,
  ): Promise<{ status: 'success' | 'pending' | 'failed'; message: string }> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { reference },
      include: { wallet: true },
    });

    if (!transaction) throw new NotFoundException('Transaction not found');
    if (transaction.wallet.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    if (transaction.status === 'SUCCESS') {
      return { status: 'success', message: 'Payment already confirmed' };
    }

    if (transaction.status === 'FAILED') {
      return { status: 'failed', message: 'Payment was unsuccessful' };
    }

    // Still PENDING — trigger on-demand reconciliation
    const result = await this.fundingReconciliationScheduler.reconcileByReference(
      reference,
      userId,
      'USER_VERIFY',
    );

    if (result.outcome === 'settled' || result.outcome === 'already_processed') {
      return { status: 'success', message: 'Payment confirmed and wallet credited' };
    }

    if (result.outcome === 'marked_failed') {
      return { status: 'failed', message: 'Payment could not be verified' };
    }

    if (result.outcome === 'still_pending') {
      return { status: 'pending', message: 'Payment is still being processed by the provider' };
    }

    return { status: 'pending', message: 'Verification in progress' };
  }

  async manualReconcileByReference(
    reference: string,
    superAdminId: string,
  ): Promise<ManualFundingReconcileResult> {
    const normalizedReference = reference.trim();
    if (!normalizedReference) {
      throw new BadRequestException('Transaction reference is required');
    }

    return this.fundingReconciliationScheduler.reconcileByReference(
      normalizedReference,
      superAdminId,
    );
  }

  private extractProviderMessage(error: unknown): string {
    if (!(error instanceof AxiosError)) {
      return error instanceof Error
        ? error.message
        : 'Provider returned an unexpected error';
    }

    const responseData = error.response?.data as Record<string, unknown> | undefined;
    const nestedData =
      responseData && typeof responseData.data === 'object' && responseData.data !== null
        ? (responseData.data as Record<string, unknown>)
        : undefined;

    return (
      (typeof responseData?.message === 'string' && responseData.message) ||
      (typeof nestedData?.message === 'string' && nestedData.message) ||
      error.message ||
      'Provider returned an unexpected error'
    );
  }
}
