// src/modules/funding/funding.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { InitializeFundingDto } from './dto/funding.dto';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { TransactionsService } from '../transactions/transactions.service';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';

@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly transactionsService: TransactionsService,
    private readonly flw: FlutterwaveProvider,
    private readonly prisma: PrismaService,
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
      metadata: {
        paymentMethod: dto.paymentMethod,
        ...dto.metadata,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // Call FLW — amount must be Naira (dto.amount is kobo)
    const providerResponse = await this.flw.initiatePayment({
      tx_ref: reference,
      amount: Number(dto.amount) / 100,
      currency: dto.currency ?? 'NGN',
      redirect_url: dto.redirectUrl,
      customer: {
        email: user?.email ?? `user-${userId}@ajoti.com`,
        name: user ? `${user.firstName} ${user.lastName}`.trim() : undefined,
        phonenumber: user?.phone ?? undefined,
      },
      // All three channels in one hosted checkout
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
}