// src/modules/funding/funding.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
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

    // Record the intent — PENDING until webhook confirms
    const transaction = await this.transactionsService.create({
      walletId: wallet.id,
      amount: BigInt(dto.amount),
      reference,
      type: TransactionType.FUNDING,
      status: TransactionStatus.PENDING,
      currency: dto.currency ?? 'NGN',
      provider: 'FLUTTERWAVE',
      metadata: dto.metadata ? (dto.metadata as Prisma.InputJsonValue) : undefined,
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
        description: 'Use your bank\'s USSD code. No internet required.',
      },
    ];
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
