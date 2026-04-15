/* eslint-disable prettier/prettier */
import { PrismaService } from '../../prisma';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CircleStatus,
  KYCStatus,
  KYCStep,
  MembershipStatus,
  OTPPurpose,
  Prisma,
  TransactionStatus,
  WalletStatus,
} from '@prisma/client';
import * as crypto from 'crypto';
import { hashValue, normalizeEmail, verifyHash } from '@/common';
import { VirtualAccountService } from '../virtual-accounts/virtual-account.service';
import { WalletService } from '../wallet/wallet.service';
import { DeleteUserAccountDto } from './dto/delete-user.dto';
import { UpdateMyProfileDto } from './dto/update-profile.dto';
import { UserProfileResponseDto } from './dto/user-profile.dto';
import { OtpService } from '../otp/otp.service';
import { emailChangeOtpTemplate } from '../mail/templates/otp-email-change';
import { AUTH_EVENTS_QUEUE, AuthJobName } from '../auth/auth.events';

const authUserSelect = {
  id: true,
  role: true,
  isVerified: true,
} satisfies Prisma.UserSelect;

const profileUserSelect = {
  email: true,
  firstName: true,
  lastName: true,
  dob: true,
  phone: true,
} satisfies Prisma.UserSelect;

const profileUpdateUserSelect = {
  id: true,
  email: true,
  pendingEmail: true,
  firstName: true,
  lastName: true,
  dob: true,
  phone: true,
  password: true,
} satisfies Prisma.UserSelect;

type AuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;
type ProfileUser = Prisma.UserGetPayload<{ select: typeof profileUserSelect }>;
type ProfileUpdateUser = Prisma.UserGetPayload<{ select: typeof profileUpdateUserSelect }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly virtualAccountService: VirtualAccountService,
    private readonly walletService: WalletService,
    private readonly otpService: OtpService,
    @InjectQueue(AUTH_EVENTS_QUEUE) private readonly authEventsQueue: Queue,
  ) {}

  async findAuthUserById(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: authUserSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async getMyProfile(userId: string): Promise<UserProfileResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileUserSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.formatProfile(user);
  }

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: profileUpdateUserSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const firstName = this.trimOptionalString(dto.firstName, 'First name');
    const lastName = this.trimOptionalString(dto.lastName, 'Last name');
    const phone = this.trimOptionalString(dto.phone, 'Phone');
    const requestedEmail = dto.email !== undefined ? normalizeEmail(dto.email) : undefined;
    const requestedDob = dto.dob;
    const requestedPassword = dto.newPassword;
    const currentPassword = dto.currentPassword;

    const updateData: Prisma.UserUpdateInput = {};
    let profileFieldsChanged = false;
    let emailOtpTarget: string | null = null;
    let emailResend = false;

    if (firstName !== undefined && firstName !== user.firstName) {
      updateData.firstName = firstName;
      profileFieldsChanged = true;
    }

    if (lastName !== undefined && lastName !== user.lastName) {
      updateData.lastName = lastName;
      profileFieldsChanged = true;
    }

    if (phone !== undefined && phone !== user.phone) {
      updateData.phone = phone;
      profileFieldsChanged = true;
    }

    if (requestedDob !== undefined) {
      const currentDob = this.formatDateOnly(user.dob);
      if (requestedDob !== currentDob) {
        updateData.dob = this.parseDateOnly(requestedDob);
        profileFieldsChanged = true;
      }
    }

    if (requestedEmail !== undefined) {
      if (this.isSameEmail(requestedEmail, user.email)) {
        // No-op: current email remains the source of truth until a verified swap happens.
      } else if (user.pendingEmail && this.isSameEmail(requestedEmail, user.pendingEmail)) {
        emailOtpTarget = user.pendingEmail;
        emailResend = true;
      } else {
        await this.ensureEmailIsAvailable(requestedEmail, user.id);
        updateData.pendingEmail = requestedEmail;
        emailOtpTarget = requestedEmail;
      }
    }

    const requiresCurrentPassword = Boolean(emailOtpTarget || requestedPassword);

    if (requiresCurrentPassword && !currentPassword) {
      throw new BadRequestException('Current password is required to change your email or password');
    }

    if (requiresCurrentPassword) {
      const passwordOk = await verifyHash(currentPassword!, user.password);
      if (!passwordOk) {
        throw new BadRequestException('Current password is incorrect');
      }
    }

    let passwordChanged = false;

    if (requestedPassword) {
      const samePassword = await verifyHash(requestedPassword, user.password);
      if (samePassword) {
        throw new BadRequestException('New password must be different from your current password');
      }

      updateData.password = await hashValue(requestedPassword);
      passwordChanged = true;
    }

    const hasUserUpdate = Object.keys(updateData).length > 0;

    if (!hasUserUpdate && !emailOtpTarget) {
      throw new BadRequestException('No changes provided');
    }

    let updatedProfile = this.formatProfile(user);

    await this.prisma.$transaction(async (tx) => {
      if (hasUserUpdate) {
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: updateData,
          select: profileUserSelect,
        });

        updatedProfile = this.formatProfile(updatedUser);
      }

      if (passwordChanged) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorType: 'USER',
            action: 'PASSWORD_CHANGED',
            entityType: 'USER',
            entityId: userId,
            metadata: {
              changedAt: new Date().toISOString(),
              refreshTokensRevoked: true,
            },
          },
        });
      }

      if (emailOtpTarget) {
        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorType: 'USER',
            action: 'EMAIL_CHANGE_REQUESTED',
            entityType: 'USER',
            entityId: userId,
            before: {
              email: user.email,
              pendingEmail: user.pendingEmail,
            },
            after: {
              email: user.email,
              pendingEmail: emailOtpTarget,
            },
            metadata: {
              requestedAt: new Date().toISOString(),
              resend: emailResend,
            },
          },
        });
      }
    });

    if (passwordChanged) {
      await this.authEventsQueue.add(
        AuthJobName.PASSWORD_CHANGED,
        {
          userId,
          email: updatedProfile.email,
          fullName: `${updatedProfile.firstName} ${updatedProfile.lastName}`,
          timestamp: new Date().toISOString(),
        },
        {
          removeOnComplete: true,
          attempts: 5,
        },
      );
    }

    if (emailOtpTarget) {
      await this.otpService.sendOtpToUser(userId, emailOtpTarget, OTPPurpose.EMAIL_CHANGE, {
        subject: 'Verify your new email address',
        buildHtml: ({ otp, expiryMinutes }) =>
          emailChangeOtpTemplate(
            otp,
            expiryMinutes,
            `${updatedProfile.firstName} ${updatedProfile.lastName}`,
          ),
      });
    }

    return {
      message: this.buildProfileUpdateMessage({
        profileFieldsChanged,
        passwordChanged,
        emailOtpTarget,
        emailResend,
      }),
      data: updatedProfile,
    };
  }

  async verifyPendingEmailChange(userId: string, otp: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...profileUserSelect,
        id: true,
        pendingEmail: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.pendingEmail) {
      throw new BadRequestException('No pending email change found');
    }

    await this.ensureEmailIsAvailable(user.pendingEmail, userId);
    await this.otpService.consumeOtpByUserId(userId, OTPPurpose.EMAIL_CHANGE, otp);

    let updatedProfile: UserProfileResponseDto | null = null;

    await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          email: user.pendingEmail!,
          pendingEmail: null,
        },
        select: profileUserSelect,
      });

      updatedProfile = this.formatProfile(updatedUser);

      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorType: 'USER',
          action: 'EMAIL_CHANGE_VERIFIED',
          entityType: 'USER',
          entityId: userId,
          before: {
            email: user.email,
            pendingEmail: user.pendingEmail,
          },
          after: {
            email: user.pendingEmail,
            pendingEmail: null,
          },
          metadata: {
            verifiedAt: new Date().toISOString(),
            refreshTokensRevoked: true,
          },
        },
      });
    });

    return {
      message: 'Email updated successfully.',
      data: updatedProfile!,
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
          'Unable to delete your virtual account at the provider. Please try again later.',
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

      await tx.savedBankAccount.deleteMany({ where: { userId } });
      await tx.userProfile.deleteMany({ where: { userId } });

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

      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          pendingEmail: null,
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

  private formatProfile(user: ProfileUser | ProfileUpdateUser): UserProfileResponseDto {
    return {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      dob: this.formatDateOnly(user.dob),
      phone: user.phone,
    };
  }

  private formatDateOnly(date: Date): string {
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  private parseDateOnly(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private trimOptionalString(value: string | undefined, fieldName: string) {
    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throw new BadRequestException(`${fieldName} cannot be empty`);
    }

    return trimmed;
  }

  private isSameEmail(left: string, right: string | null) {
    return right !== null && normalizeEmail(left) === normalizeEmail(right);
  }

  private async ensureEmailIsAvailable(email: string, excludeUserId: string) {
    const conflict = await this.prisma.user.findFirst({
      where: {
        id: { not: excludeUserId },
        OR: [
          {
            email: {
              equals: email,
              mode: 'insensitive',
            },
          },
          {
            pendingEmail: {
              equals: email,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: { id: true },
    });

    if (conflict) {
      throw new ConflictException('Email is already in use');
    }
  }

  private buildProfileUpdateMessage(args: {
    profileFieldsChanged: boolean;
    passwordChanged: boolean;
    emailOtpTarget: string | null;
    emailResend: boolean;
  }) {
    if (args.emailOtpTarget && !args.passwordChanged && !args.profileFieldsChanged) {
      return args.emailResend
        ? 'Email change OTP sent successfully.'
        : 'Email change initiated. Verify the OTP sent to your new email.';
    }

    if (args.emailOtpTarget) {
      return 'Profile updated successfully. Verify the OTP sent to your new email to complete the email change.';
    }

    if (args.passwordChanged && !args.profileFieldsChanged) {
      return 'Password changed successfully.';
    }

    return 'Profile updated successfully.';
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

  // ── Transaction PIN ──────────────────────────────────────────────────────────

  async setTransactionPin(userId: string, pin: string, currentPin?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { transactionPin: true },
    });

    if (!user) throw new NotFoundException('User not found');

    // If a PIN is already set, require the current PIN to change it
    if (user.transactionPin) {
      if (!currentPin) {
        throw new BadRequestException('Current PIN is required to change your transaction PIN');
      }
      const valid = await verifyHash(currentPin, user.transactionPin);
      if (!valid) {
        throw new BadRequestException('Current PIN is incorrect');
      }
    }

    const pinHash = await hashValue(pin);
    await this.prisma.user.update({
      where: { id: userId },
      data: { transactionPin: pinHash },
    });

    return { message: user.transactionPin ? 'Transaction PIN updated successfully' : 'Transaction PIN set successfully' };
  }

  async hasPinSet(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { transactionPin: true },
    });
    return Boolean(user?.transactionPin);
  }
}
