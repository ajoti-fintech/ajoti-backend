import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Wallet, WalletStatus, Prisma, BucketType } from '@prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { WalletBalanceResponseDto, formatBalanceResponse } from './dto/wallet.dto';

// Type definition for internal service use
export interface WalletBalance {
  total: bigint;
  reserved: bigint;
  available: bigint;
}

// Result type for the unified response
export interface WalletWithBalance extends Wallet {
  balance: WalletBalanceResponseDto;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Create a new wallet for a user.
   * Buckets are now created dynamically during RESERVE/RELEASE operations
   * in the LedgerService to support multi-source tracking (e.g. separate ROSCA circles).
   */
  async createWallet(userId: string): Promise<Wallet> {
    const existingWallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (existingWallet) {
      throw new ConflictException(`Wallet already exists for user ${userId}`);
    }

    return await this.prisma.wallet.create({
      data: {
        userId,
        currency: 'NGN',
        status: WalletStatus.ACTIVE,
      },
    });
  }

  /**
   * Lazy initialisation: Get wallet or create it if missing.
   */
  async getOrCreateWallet(userId: string): Promise<Wallet> {
    if (!userId) throw new BadRequestException('Invalid userId');

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (wallet) return wallet;

    return this.createWallet(userId);
  }

  async getWalletById(walletId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw new NotFoundException(`Wallet with ID ${walletId} not found`);
    return wallet;
  }

  /**
   * Delegates balance calculation to the Ledger Service (Source of Truth).
   */
  async getBalance(walletId: string): Promise<WalletBalance> {
    return await this.ledgerService.getDetailedBalance(walletId);
  }

  /**
   * Orchestrates the full wallet state including balance.
   */
  async getWalletWithBalance(userId: string): Promise<WalletWithBalance> {
    const wallet = await this.getOrCreateWallet(userId);
    const balance = await this.getBalance(wallet.id);

    return {
      ...wallet,
      balance: formatBalanceResponse(balance),
    };
  }

  async updateWalletStatus(walletId: string, status: WalletStatus): Promise<Wallet> {
    await this.getWalletById(walletId);
    return await this.prisma.wallet.update({
      where: { id: walletId },
      data: { status },
    });
  }

  async isWalletActive(walletId: string): Promise<boolean> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      select: { status: true },
    });
    return wallet?.status === WalletStatus.ACTIVE;
  }

  async canWithdraw(walletId: string): Promise<boolean> {
    const wallet = await this.getWalletById(walletId);
    // Restricted wallets can often still withdraw to 'empty' the account per local regulations
    return wallet.status === WalletStatus.ACTIVE || wallet.status === WalletStatus.RESTRICTED;
  }

  /**
   * Aggregates stats from the Ledger for the UI.
   */
  async getWalletStats(walletId: string) {
    await this.getWalletById(walletId);

    const [totalTransactions, lastEntry, credits, debits] = await Promise.all([
      this.prisma.ledgerEntry.count({ where: { walletId } }),
      this.prisma.ledgerEntry.findFirst({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.ledgerEntry.count({ where: { walletId, entryType: 'CREDIT' } }),
      this.prisma.ledgerEntry.count({ where: { walletId, entryType: 'DEBIT' } }),
    ]);

    return {
      totalTransactions,
      totalCredits: credits,
      totalDebits: debits,
      lastTransaction: lastEntry?.createdAt || null,
    };
  }

  /**
   * Validates if the available balance (Total - Sum of all Reserved Buckets)
   * is enough for a transaction.
   */
  async hasSufficientBalance(walletId: string, amount: bigint): Promise<boolean> {
    const balance = await this.getBalance(walletId);
    return balance.available >= amount;
  }

  async freezeWallet(walletId: string): Promise<Wallet> {
    return this.updateWalletStatus(walletId, WalletStatus.SUSPENDED);
  }

  async unfreezeWallet(walletId: string): Promise<Wallet> {
    return this.updateWalletStatus(walletId, WalletStatus.ACTIVE);
  }

  /**
   * Fetches all buckets for a wallet.
   * Note: The LedgerService handles the upserting of these during business logic.
   */
  async getWalletBuckets(walletId: string) {
    await this.getWalletById(walletId);
    return await this.prisma.walletBucket.findMany({
      where: { walletId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Verifies that a wallet belongs to a specific user.
   * Throws NotFoundException if wallet doesn't exist or doesn't belong to user.
   */
  async verifyWalletOwnership(walletId: string, userId: string): Promise<void> {
    const wallet = await this.getWalletById(walletId);

    if (wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found or does not belong to user');
    }
  }
}
