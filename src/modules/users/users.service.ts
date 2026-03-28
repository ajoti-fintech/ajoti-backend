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
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  /**
   * Fintech-safe account closure.
   *
   * We do NOT hard-delete the user row because historical financial records
   * (ledger, contributions, payouts) must remain referentially intact.
   * Instead, we:
   * 1) validate ownership and password
   * 2) ensure no active/pending obligations
   * 3) delete VA at provider (if any)
   * 4) close wallet + revoke auth + anonymize PII atomically
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

    await this.ensureAccountCanBeClosed(userId);

    const existingVa = await this.prisma.virtualAccount.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (existingVa) {
      try {
        await this.virtualAccountService.deleteForUser(userId);
      } catch (error) {
        throw new ServiceUnavailableException(
          'Unable to delete your virtual account at the provider. Please try again.',
        );
      }
    }

    const anonymizedEmail = `deleted+${user.id}+${Date.now()}@ajoti.local`;
    const anonymizedPhone = `000${crypto.randomInt(10000000, 99999999)}`;
    const replacementPassword = await hashValue(crypto.randomUUID());

    await this.prisma.$transaction(async (tx) => {
      if (user.wallet?.id) {
        await tx.wallet.update({
          where: { id: user.wallet.id },
          data: { status: WalletStatus.CLOSED },
        });
      }

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.otpCode.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.savedBankAccount.deleteMany({
        where: { userId },
      });

      await tx.userProfile.deleteMany({
        where: { userId },
      });

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
          reviewedBy: null,
          rejectionReason: null,
        },
      });

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
          reason: dto.reason ?? null,
          metadata: {
            virtualAccountDeleted: Boolean(existingVa),
          },
        },
      });
    });

    return {
      message: 'Account closed successfully',
    };
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
      throw new ConflictException(
        'Account cannot be closed while you have active or pending ROSCA memberships.',
      );
    }

    if (activeAdminCircles > 0) {
      throw new ConflictException(
        'Account cannot be closed while you still administer active or draft ROSCA circles.',
      );
    }

    const wallet = await this.walletService.findByUserId(userId);
    if (!wallet) return;

    const [balance, pendingTransactions, lockedBuckets] = await Promise.all([
      this.walletService.getBalance(wallet.id),
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
      throw new ConflictException(
        'Account cannot be closed while there are pending transactions.',
      );
    }

    if (lockedBuckets > 0 || balance.reserved > 0n) {
      throw new ConflictException(
        'Account cannot be closed while funds are still reserved.',
      );
    }

    if (balance.total !== 0n || balance.available !== 0n) {
      throw new ConflictException(
        'Wallet balance must be zero before account closure.',
      );
    }
  }
}
