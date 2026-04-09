jest.mock('../virtual-accounts/virtual-account.service', () => ({
  VirtualAccountService: class VirtualAccountService {},
}));

jest.mock('../wallet/wallet.service', () => ({
  WalletService: class WalletService {},
}));

import { BadRequestException, ConflictException } from '@nestjs/common';
import { OTPPurpose } from '@prisma/client';
import { hashValue } from '@/common';
import { AuthJobName } from '../auth/auth.events';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VirtualAccountService } from '../virtual-accounts/virtual-account.service';
import { WalletService } from '../wallet/wallet.service';
import { NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
  const tx = {
    user: { update: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    refreshToken: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
    roscaMembership: { count: jest.fn() },
    roscaCircle: { count: jest.fn() },
    transaction: { count: jest.fn() },
    walletBucket: { count: jest.fn() },
    savedBankAccount: { deleteMany: jest.fn() },
    userProfile: { deleteMany: jest.fn() },
    kYC: { updateMany: jest.fn() },
    otpCode: { updateMany: jest.fn() },
    wallet: { update: jest.fn() },
    virtualAccount: { findUnique: jest.fn() },
    $transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
  };

  const virtualAccountService = {
    deleteForUser: jest.fn(),
  };

  const walletService = {
    findByUserId: jest.fn(),
    getBalance: jest.fn(),
  };

  const otpService = {
    sendOtpToUser: jest.fn(),
    consumeOtpByUserId: jest.fn(),
  };

  const authEventsQueue = {
    add: jest.fn(),
  };

  let service: UsersService;

  const mockPrisma: any = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prisma as any,
      virtualAccountService as any,
      walletService as any,
      otpService as any,
      authEventsQueue as any,
    );
  });

  it('returns only the canonical profile shape for getMyProfile', async () => {
    prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Iseoluwa',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
    });

    await expect(service.getMyProfile('user-1')).resolves.toEqual({
      email: 'user@example.com',
      firstName: 'Iseoluwa',
      lastName: 'Afolayan',
      dob: '1990-01-01',
      phone: '+2348012345678',
    });
  });

  it('updates non-sensitive profile fields without requiring currentPassword', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      pendingEmail: null,
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
      password: await hashValue('CurrentPassword123'),
    });

    tx.user.update.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Iseoluwa',
      lastName: 'Afolayan',
      dob: new Date('1990-02-14T00:00:00.000Z'),
      phone: '+2348099999999',
    });

    const result = await service.updateMyProfile('user-1', {
      firstName: 'Iseoluwa',
      dob: '1990-02-14',
      phone: '+2348099999999',
    });

    expect(result).toEqual({
      message: 'Profile updated successfully.',
      data: {
        email: 'user@example.com',
        firstName: 'Iseoluwa',
        lastName: 'Afolayan',
        dob: '1990-02-14',
        phone: '+2348099999999',
      },
    });
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(otpService.sendOtpToUser).not.toHaveBeenCalled();
  });

  it('requires currentPassword for sensitive email or password changes', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      pendingEmail: null,
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
      password: await hashValue('CurrentPassword123'),
    });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.updateMyProfile('user-1', {
        email: 'new@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects duplicate emails found in either active email or pendingEmail', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      pendingEmail: null,
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
      password: await hashValue('CurrentPassword123'),
    });
    prisma.user.findFirst.mockResolvedValue({ id: 'user-2' });

    await expect(
      service.updateMyProfile('user-1', {
        email: 'taken@example.com',
        currentPassword: 'CurrentPassword123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats requesting the same pending email as a resend flow', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      pendingEmail: 'new@example.com',
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
      password: await hashValue('CurrentPassword123'),
    });

    const result = await service.updateMyProfile('user-1', {
      email: 'NEW@example.com',
      currentPassword: 'CurrentPassword123',
    });

    expect(result.message).toBe('Email change OTP sent successfully.');
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(otpService.sendOtpToUser).toHaveBeenCalledWith(
      'user-1',
      'new@example.com',
      OTPPurpose.EMAIL_CHANGE,
      expect.objectContaining({
        subject: 'Verify your new email address',
      }),
    );
  });

  it('supports combined profile, password, and email updates in one request', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      pendingEmail: null,
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
      password: await hashValue('CurrentPassword123'),
    });
    prisma.user.findFirst.mockResolvedValue(null);
    tx.user.update.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Iseoluwa',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348099999999',
    });

    const result = await service.updateMyProfile('user-1', {
      firstName: 'Iseoluwa',
      phone: '+2348099999999',
      email: 'new@example.com',
      newPassword: 'StrongerPassword123',
      currentPassword: 'CurrentPassword123',
    });

    expect(result.message).toContain('Verify the OTP sent to your new email');
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(authEventsQueue.add).toHaveBeenCalledWith(
      AuthJobName.PASSWORD_CHANGED,
      expect.objectContaining({
        userId: 'user-1',
        email: 'user@example.com',
        fullName: 'Iseoluwa Afolayan',
      }),
      expect.any(Object),
    );
    expect(otpService.sendOtpToUser).toHaveBeenCalledWith(
      'user-1',
      'new@example.com',
      OTPPurpose.EMAIL_CHANGE,
      expect.any(Object),
    );
  });

  it('verifies a pending email change, swaps the active email, and revokes refresh tokens', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      pendingEmail: 'new@example.com',
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
    });
    prisma.user.findFirst.mockResolvedValue(null);
    otpService.consumeOtpByUserId.mockResolvedValue({
      id: 'user-1',
    });
    tx.user.update.mockResolvedValue({
      email: 'new@example.com',
      firstName: 'Ise',
      lastName: 'Afolayan',
      dob: new Date('1990-01-01T00:00:00.000Z'),
      phone: '+2348012345678',
    });

    const result = await service.verifyPendingEmailChange('user-1', '123456');

    expect(result).toEqual({
      message: 'Email updated successfully.',
      data: {
        email: 'new@example.com',
        firstName: 'Ise',
        lastName: 'Afolayan',
        dob: '1990-01-01',
        phone: '+2348012345678',
      },
    });
    expect(otpService.consumeOtpByUserId).toHaveBeenCalledWith(
      'user-1',
      OTPPurpose.EMAIL_CHANGE,
      '123456',
    );
    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
  });

  describe('findById', () => {
    it('should return a user when found', async () => {
      const mockUser = { id: 'user-1', email: 'test@test.com', firstName: 'Test', lastName: 'User', wallet: null };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.findAuthUserById('user-1');
      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.findAuthUserById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
