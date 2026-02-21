// src/modules/funding/funding.service.ts
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { InitializeFundingDto } from './dto/funding.dto';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { TransactionsService } from '../transactions/transactions.service';
import { FlutterwaveService } from '../transactions/flutterwave.service';

@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);

  constructor(
    private walletService: WalletService,
    private transactionsService: TransactionsService,
    private flutterwave: FlutterwaveService,
    private prisma: PrismaService,
  ) {}

  /**
   * Initialize funding session with Flutterwave
   */
  async initialize(userId: string, dto: InitializeFundingDto) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    if (!wallet) throw new BadRequestException('Wallet not found');
    if (wallet.status !== 'ACTIVE') throw new BadRequestException('Wallet is not active');

    const reference = `AJT-FUND-${crypto.randomUUID()}`;

    // Use transactionsService to create the record
    const transaction = await this.transactionsService.create({
      walletId: wallet.id,
      amount: BigInt(dto.amount),
      reference,
      type: TransactionType.FUNDING,
      status: TransactionStatus.PENDING,
      currency: 'NGN',
      metadata: {
        paymentMethod: dto.paymentMethod,
        ...dto.metadata,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    // Initialize with Provider
    const providerResponse = await this.flutterwave.initializePayment({
      tx_ref: reference,
      amount: Number(dto.amount) / 100, // Kobo to Naira for FLW
      currency: dto.currency || 'NGN',
      redirect_url: dto.redirectUrl,
      customer: {
        email: user?.email || `user-${userId}@ajoti.com`,
        name: user ? `${user.firstName} ${user.lastName}`.trim() : undefined,
      },
      meta: {
        transactionId: transaction.id,
        walletId: wallet.id,
        userId,
      },
    });

    if (providerResponse.status !== 'success' || !providerResponse.data) {
      this.logger.error(`Flutterwave initialization failed: ${providerResponse.message}`);
      throw new BadRequestException(
        providerResponse.message || 'Payment provider returned an empty response',
      );
    }

    return {
      reference,
      authorizationUrl: providerResponse.data.link,
      provider: 'FLUTTERWAVE',
    };
  }

  /**
   * Get funding methods (UI helper)
   */
  async getFundingMethods() {
    return [
      { id: 'CARD', name: 'Card Payment', icon: 'credit-card', fee: 0, minAmount: 10000 },
      { id: 'BANK_TRANSFER', name: 'Bank Transfer', icon: 'bank', fee: 5000, minAmount: 10000 },
      { id: 'USSD', name: 'USSD', icon: 'phone', fee: 0, minAmount: 10000 },
    ];
  }
}
