/* eslint-disable prettier/prettier */
import { PrismaService } from '../../prisma';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CircleStatus,
  KYCStatus,
  KYCStep,
  MembershipStatus,
  TransactionStatus,
  WalletStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { hashValue, verifyHash } from '@/common';
import { VirtualAccountService } from '../virtual-accounts/virtual-account.service';
import { WalletService } from '../wallet/wallet.service';
import { DeleteUserAccountDto } from './dto/delete-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly virtualAccountService: VirtualAccountService,
    private readonly walletService: WalletService,
  ) {}

  async findById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isVerified: true,
        role: true, // Good to include for frontend routing
        createdAt: true,
        wallet: {
          select: {
            balance: true,
            currency: true,
          },
        },
        virtualAccount: {
          select: {
            accountNumber: true,
            bankName: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Standard practice: return a clean object with BigInts stringified
    return {
      ...user,
      wallet: user.wallet
        ? {
            ...user.wallet,
            // Cast to bigint to ensure .toString() is available
            balance: (user.wallet.balance as bigint).toString(),
          }
        : null,
    };
  }

  /**
   * Fintech-safe account closure.
   */
  async closeAccount(userId: string, dto: DeleteUserAccountDto) {
    if (dto.confirm.trim().toUpperCase() !== 'DELETE') {
      throw new BadRequestException('Confirmation phrase must be DELETE');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const passwordOk = await verifyHash(dto.currentPassword, user.password);
    if (!passwordOk) {
      throw new BadRequestException('Current password is incorrect');
    }

    // 1. Ensure no financial or ROSCA obligations
    await this.ensureAccountCanBeClosed(userId);

    // 2. Check for Virtual Account
    const existingVa = await this.prisma.virtualAccount.findUnique({
      where: { userId },
      select: { id: true },
    });

    // 3. External API call (Provider) happens BEFORE DB transaction
    if (existingVa) {
      try {
        await this.virtualAccountService.deleteForUser(userId);
      } catch (error) {
        throw new ServiceUnavailableException(
          'Unable to delete your virtual account at the provider. Please try again later.',
        );
      }
    }

    const anonymizedEmail = `deleted+${user.id}+${Date.now()}@ajoti.local`;
    const anonymizedPhone = `000${crypto.randomInt(10000000, 99999999)}`;
    const replacementPassword = await hashValue(crypto.randomUUID());

    // 4. Atomic Database Updates
    await this.prisma.$transaction(async (tx) => {
      if (user.wallet?.id) {
        await tx.wallet.update({
          where: { id: user.wallet.id },
          data: { status: WalletStatus.CLOSED },
        });
      }

      // Revoke sessions and codes
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.otpCode.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });

      // Cleanup PII
      await tx.savedBankAccount.deleteMany({ where: { userId } });
      await tx.userProfile.deleteMany({ where: { userId } });

      // Reset KYC but keep the record for audit/uniqueness
      await tx.kYC.updateMany({
        where: { userId },
        data: {
          status: KYCStatus.NOT_SUBMITTED,
          step: KYCStep.NIN_REQUIRED,
          nin: null,
          bvn: null,
          ninVerifiedAt: null,
          bvnVerifiedAt: null,
          nextOfKinName: null,
          nextOfKinRelationship: null,
          nextOfKinPhone: null,
          submittedAt: null,
          reviewedAt: null,
          rejectionReason: null,
        },
      });

      // Anonymize the main User record
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          firstName: 'Deleted',
          lastName: 'User',
          phone: anonymizedPhone,
          isVerified: false,
          password: replacementPassword,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorType: 'USER',
          action: 'ACCOUNT_CLOSED',
          entityType: 'USER',
          entityId: userId,
          reason: dto.reason ?? 'User requested closure',
          metadata: {
            virtualAccountDeleted: Boolean(existingVa),
            closedAt: new Date().toISOString(),
          },
        },
      });
    });

    return { message: 'Account closed successfully' };
  }

  private async ensureAccountCanBeClosed(userId: string): Promise<void> {
    const [activeMemberships, activeAdminCircles] = await Promise.all([
      this.prisma.roscaMembership.count({
        where: {
          userId,
          status: { in: [MembershipStatus.PENDING, MembershipStatus.ACTIVE] },
        },
      }),
      this.prisma.roscaCircle.count({
        where: {
          adminId: userId,
          status: { in: [CircleStatus.DRAFT, CircleStatus.ACTIVE] },
        },
      }),
    ]);

    if (activeMemberships > 0) {
      throw new ConflictException('You have active or pending ROSCA memberships.');
    }

    if (activeAdminCircles > 0) {
      throw new ConflictException('You still administer active or draft ROSCA circles.');
    }

    const wallet = await this.walletService.findByUserId(userId);
    if (!wallet) return;

    // Use getBalance and ensure BigInt safety
    const balance = await this.walletService.getBalance(wallet.id);

    const [pendingTransactions, lockedBuckets] = await Promise.all([
      this.prisma.transaction.count({
        where: {
          walletId: wallet.id,
          status: TransactionStatus.PENDING,
        },
      }),
      this.prisma.walletBucket.count({
        where: {
          walletId: wallet.id,
          reservedAmount: { gt: 0n },
        },
      }),
    ]);

    if (pendingTransactions > 0) {
      throw new ConflictException('You have pending transactions.');
    }

    // Explicit BigInt comparisons
    const reserved = BigInt(balance.reserved);
    const total = BigInt(balance.total);
    const available = BigInt(balance.available);

    if (lockedBuckets > 0 || reserved > 0n) {
      throw new ConflictException('Funds are still reserved/locked in your wallet.');
    }

    if (total !== 0n || available !== 0n) {
      throw new ConflictException('Wallet balance must be exactly zero.');
    }
  }
}
