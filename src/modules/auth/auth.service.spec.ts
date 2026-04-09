import { hashValue } from '@/common';
import { AuthService } from './auth.service';
import { UnauthorizedException } from '@nestjs/common';
import { OTPPurpose, Role } from '@prisma/client';
import { AuthJobName } from './auth.events';

describe('AuthService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_EXPIRES_IN: '1h',
        JWT_ACCESS_SECRET: 'test-secret',
        JWT_REFRESH_EXPIRES_IN: '30d',
      };
      return values[key];
    }),
  };

  const jwt = {
    signAsync: jest.fn().mockResolvedValue('access-token'),
  };

  const otpService = {
    sendOtp: jest.fn(),
    consumeOtp: jest.fn(),
  };

  const authEventsQueue = {
    add: jest.fn(),
  };

  let service: AuthService;

  const mockPrisma: any = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma as any,
      config as any,
      jwt as any,
      otpService as any,
      authEventsQueue as any,
    );
  });

  it('normalizes email before checking uniqueness and creating new users', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    await service.register({
      firstName: 'Ise',
      lastName: 'Afolayan',
      email: 'User@Example.COM ',
      dob: '1990-01-01',
      gender: 'MALE',
      phone: '+2348012345678',
      password: 'CurrentPassword123',
      role: Role.MEMBER,
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { equals: 'user@example.com', mode: 'insensitive' } },
            { pendingEmail: { equals: 'user@example.com', mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
    );
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'user@example.com',
        }),
      }),
    );
    expect(otpService.sendOtp).toHaveBeenCalledWith(
      'user@example.com',
      OTPPurpose.VERIFICATION,
      expect.any(Object),
    );
    expect(authEventsQueue.add).toHaveBeenCalledWith(
      AuthJobName.USER_REGISTERED,
      expect.objectContaining({ email: 'user@example.com' }),
      expect.any(Object),
    );
  });

  it('normalizes email for login and issues tokens for the matched user', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      password: await hashValue('CurrentPassword123'),
      role: Role.MEMBER,
      isVerified: true,
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.create.mockResolvedValue({ id: 'token-1' });

    const result = await service.login(' User@Example.com ', 'CurrentPassword123');

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: { equals: 'user@example.com', mode: 'insensitive' },
        },
      }),
    );
    expect(result).toEqual({
      accessToken: 'access-token',
      refreshToken: expect.any(String),
      expiresIn: '1h',
    });
  });

  it('normalizes email for forgot-password lookups before sending reset OTPs', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Ise',
      lastName: 'Afolayan',
    });

    await service.forgotPassword({ email: ' User@Example.com ' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: { equals: 'user@example.com', mode: 'insensitive' },
        },
      }),
    );
    expect(otpService.sendOtp).toHaveBeenCalledWith(
      'user@example.com',
      OTPPurpose.RESET_PASSWORD,
      expect.any(Object),
    );
  });

  describe('refreshTokens', () => {
    it('should throw UnauthorizedException for an invalid refresh token', async () => {
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
      await expect(service.refreshTokens('invalid-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for an expired refresh token', async () => {
      // The query filters by revokedAt: null AND expiresAt: gt: now
      // An expired token simply won't match — findFirst returns null
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
      await expect(service.refreshTokens('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for a revoked refresh token', async () => {
      // A revoked token also won't match the query — findFirst returns null
      mockPrisma.refreshToken.findFirst.mockResolvedValue(null);
      await expect(service.refreshTokens('revoked-token')).rejects.toThrow(UnauthorizedException);
    });
  });
});
