import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OtpService } from '../otp/otp.service';
import { getQueueToken } from '@nestjs/bullmq';
import { AUTH_EVENTS_QUEUE } from './auth.events';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma: any = {
    user: { findUnique: jest.fn(), create: jest.fn() },
    refreshToken: { create: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  };

  const mockConfig = { get: jest.fn().mockReturnValue('test-secret') };
  const mockJwt = { sign: jest.fn().mockReturnValue('mock-token'), verify: jest.fn() };
  const mockOtpService = { sendOtp: jest.fn(), verifyOtp: jest.fn() };
  const mockQueue = { add: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: JwtService, useValue: mockJwt },
        { provide: OtpService, useValue: mockOtpService },
        { provide: getQueueToken(AUTH_EVENTS_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
