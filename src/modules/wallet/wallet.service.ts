import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Wallet, WalletStatus, Prisma } from '@prisma/client';
import { LedgerService } from '../ledger/ledger.service';

// Response DTOs
export interface WalletBalance {
  total: bigint;
  reserved: bigint;
  available: bigint;
}

export interface WalletWithBalance extends Wallet {
  balance: {
    total: string; // Convert BigInt to string for JSON serialization
    reserved: string;
    available: string;
    currency: string;
  };
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  /**
   * Create a new wallet for a user
   * Called during user registration or first wallet access
   *
   * @param userId - The user's unique identifier
   * @returns Created wallet with initialized buckets
   * @throws ConflictException if wallet already exists
   */
  async createWallet(userId: string): Promise<Wallet> {
    // Check if wallet already exists
    const existingWallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (existingWallet) {
      throw new ConflictException(`Wallet already exists for user ${userId}`);
    }

    // Use transaction to ensure wallet and buckets are created atomically
    return await this.prisma.$transaction(
      async (tx) => {
        // Create wallet
        const wallet = await tx.wallet.create({
          data: {
            userId,
            currency: 'NGN',
            status: WalletStatus.ACTIVE,
          },
        });

        // Create default buckets (all starting at 0)
        await tx.walletBucket.createMany({
          data: [
            {
              walletId: wallet.id,
              bucketType: 'ROSCA',
              reservedAmount: 0n,
            },
            {
              walletId: wallet.id,
              bucketType: 'TARGET',
              reservedAmount: 0n,
            },
            {
              walletId: wallet.id,
              bucketType: 'FIXED',
              reservedAmount: 0n,
            },
            {
              walletId: wallet.id,
              bucketType: 'REMITTANCE',
              reservedAmount: 0n,
            },
          ],
        });

        return wallet;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * Get wallet by user ID
   * Creates wallet if it doesn't exist (lazy initialization)
   *
   * @param userId - The user's unique identifier
   * @returns User's wallet
   */
  async getOrCreateWallet(userId: string): Promise<Wallet> {
    // Validate userId
    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('Invalid userId');
    }

    // Try to get existing wallet
    let wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    // Create if doesn't exist
    if (!wallet) {
      wallet = await this.createWallet(userId);
    }

    return wallet;
  }

  /**
   * Get wallet by wallet ID
   *
   * @param walletId - The wallet's unique identifier
   * @returns Wallet
   * @throws NotFoundException if wallet doesn't exist
   */
  async getWalletById(walletId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new NotFoundException(`Wallet with ID ${walletId} not found`);
    }

    return wallet;
  }

  /**
   * Get wallet by user ID (without auto-creation)
   *
   * @param userId - The user's unique identifier
   * @returns Wallet or null
   */
  async getWalletByUserId(userId: string): Promise<Wallet | null> {
    return await this.prisma.wallet.findUnique({
      where: { userId },
    });
  }

  /**
   * Compute balance from ledger (derived, not stored)
   *
   * Formula:
   * - total = Σ(CREDIT) − Σ(DEBIT)
   * - reserved = Σ(wallet_buckets.reserved_amount)
   * - available = total − reserved
   *
   * @param walletId - The wallet's unique identifier
   * @returns Balance breakdown
   * @throws NotFoundException if wallet doesn't exist
   */
  async getBalance(walletId: string): Promise<WalletBalance> {
    // Verify wallet exists
    await this.getWalletById(walletId);

    // Compute total from ledger (source of truth)
    const total = await this.ledgerService.computeBalance(walletId);

    // Get reserved amount from buckets
    const buckets = await this.prisma.walletBucket.findMany({
      where: { walletId },
    });

    // Sum all reserved amounts
    const reserved = buckets.reduce((sum, bucket) => sum + bucket.reservedAmount, 0n);

    // Calculate available balance
    const available = total - reserved;

    // Ensure available balance is not negative (safety check)
    if (available < 0n) {
      throw new BadRequestException('Invalid state: Available balance cannot be negative');
    }

    return {
      total,
      reserved,
      available,
    };
  }

  /**
   * Get wallet with computed balance
   *
   * @param userId - The user's unique identifier
   * @returns Wallet with balance information
   */
  async getWalletWithBalance(userId: string): Promise<WalletWithBalance> {
    const wallet = await this.getOrCreateWallet(userId);
    const balance = await this.getBalance(wallet.id);

    return {
      ...wallet,
      balance: {
        total: balance.total.toString(),
        reserved: balance.reserved.toString(),
        available: balance.available.toString(),
        currency: wallet.currency,
      },
    };
  }

  /**
   * Update wallet status
   * Used for administrative actions (freeze, suspend, close)
   *
   * @param walletId - The wallet's unique identifier
   * @param status - New wallet status
   * @returns Updated wallet
   */
  async updateWalletStatus(walletId: string, status: WalletStatus): Promise<Wallet> {
    // Verify wallet exists
    await this.getWalletById(walletId);

    return await this.prisma.wallet.update({
      where: { id: walletId },
      data: { status },
    });
  }

  /**
   * Check if wallet can perform operations
   *
   * @param walletId - The wallet's unique identifier
   * @returns true if wallet is active
   */
  async isWalletActive(walletId: string): Promise<boolean> {
    const wallet = await this.getWalletById(walletId);
    return wallet.status === WalletStatus.ACTIVE;
  }

  /**
   * Check if wallet can withdraw funds
   *
   * @param walletId - The wallet's unique identifier
   * @returns true if withdrawals are allowed
   */
  async canWithdraw(walletId: string): Promise<boolean> {
    const wallet = await this.getWalletById(walletId);
    return wallet.status === WalletStatus.ACTIVE || wallet.status === WalletStatus.RESTRICTED;
  }

  /**
   * Verify user owns wallet
   *
   * @param walletId - The wallet's unique identifier
   * @param userId - The user's unique identifier
   * @throws NotFoundException if wallet doesn't exist or doesn't belong to user
   */
  async verifyWalletOwnership(walletId: string, userId: string): Promise<void> {
    const wallet = await this.getWalletById(walletId);

    if (wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found or does not belong to user');
    }
  }

  /**
   * Get wallet statistics
   *
   * @param walletId - The wallet's unique identifier
   * @returns Wallet statistics
   */
  async getWalletStats(walletId: string): Promise<{
    totalTransactions: number;
    totalCredits: number;
    totalDebits: number;
    lastTransaction: Date | null;
  }> {
    await this.getWalletById(walletId);

    // Get transaction counts
    const [totalTransactions, lastEntry] = await Promise.all([
      this.prisma.ledgerEntry.count({
        where: { walletId },
      }),
      this.prisma.ledgerEntry.findFirst({
        where: { walletId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Count credits and debits
    const [credits, debits] = await Promise.all([
      this.prisma.ledgerEntry.count({
        where: { walletId, entryType: 'CREDIT' },
      }),
      this.prisma.ledgerEntry.count({
        where: { walletId, entryType: 'DEBIT' },
      }),
    ]);

    return {
      totalTransactions,
      totalCredits: credits,
      totalDebits: debits,
      lastTransaction: lastEntry?.createdAt || null,
    };
  }

  /**
   * Check if wallet has sufficient available balance
   *
   * @param walletId - The wallet's unique identifier
   * @param amount - Amount to check in kobo
   * @returns true if sufficient balance available
   */
  async hasSufficientBalance(walletId: string, amount: bigint): Promise<boolean> {
    const balance = await this.getBalance(walletId);
    return balance.available >= amount;
  }

  /**
   * Freeze wallet (admin action)
   * Prevents all operations
   *
   * @param walletId - The wallet's unique identifier
   * @param reason - Reason for freezing
   * @returns Updated wallet
   */
  async freezeWallet(walletId: string, reason?: string): Promise<Wallet> {
    const wallet = await this.updateWalletStatus(walletId, WalletStatus.SUSPENDED);

    // TODO: Log admin action with reason
    // await this.auditLog.log('WALLET_FROZEN', { walletId, reason });

    return wallet;
  }

  /**
   * Unfreeze wallet (admin action)
   *
   * @param walletId - The wallet's unique identifier
   * @returns Updated wallet
   */
  async unfreezeWallet(walletId: string): Promise<Wallet> {
    return await this.updateWalletStatus(walletId, WalletStatus.ACTIVE);
  }

  /**
   * Get all buckets for a wallet
   *
   * @param walletId - The wallet's unique identifier
   * @returns Array of wallet buckets with their reserved amounts
   */
  async getWalletBuckets(walletId: string) {
    await this.getWalletById(walletId);

    return await this.prisma.walletBucket.findMany({
      where: { walletId },
    });
  }
}
