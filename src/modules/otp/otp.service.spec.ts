import { Test, TestingModule } from '@nestjs/testing';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { MailQueue } from '../mail/mail.queue';
import { MailErrorMapper } from '@/common/error/mail-error';
import { BadRequestException } from '@nestjs/common';
import { OTPPurpose } from '@prisma/client';

describe('OtpService', () => {
  let service: OtpService;

  const mockPrisma: any = {
    otpCode: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockConfig = { get: jest.fn().mockReturnValue('10') };
  const mockMailQueue = { sendOtp: jest.fn().mockResolvedValue(undefined) };
  const mockMailErrorMapper = { map: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: MailQueue, useValue: mockMailQueue },
        { provide: MailErrorMapper, useValue: mockMailErrorMapper },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('consumeOtp', () => {
    it('should throw if user is not found', async () => {
      mockPrisma.user = { findUnique: jest.fn().mockResolvedValue(null) };
      await expect(
        service.consumeOtp('notfound@test.com', OTPPurpose.VERIFICATION, '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if no valid OTP record exists', async () => {
      mockPrisma.user = { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) };
      mockPrisma.otpCode.findFirst.mockResolvedValue(null);
      await expect(
        service.consumeOtp('test@test.com', OTPPurpose.VERIFICATION, '123456'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
