import { hashValue } from '@/common';
import { OTPPurpose } from '@prisma/client';
import { OtpService } from './otp.service';

describe('OtpService', () => {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    otpCode: {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };

  const config = {
    get: jest.fn().mockReturnValue('10'),
  };

  const mailQueue = {
    enqueue: jest.fn(),
  };

  const mailErrorMapper = {
    map: jest.fn(),
  };

  let service: OtpService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OtpService(
      prisma as any,
      config as any,
      mailQueue as any,
      mailErrorMapper as any,
    );
  });

  it('can send OTPs by userId and normalizes the recipient email address', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.otpCode.updateMany.mockResolvedValue({ count: 1 });
    prisma.otpCode.create.mockResolvedValue({ id: 'otp-1' });

    await service.sendOtpToUser('user-1', ' New@Example.com ', OTPPurpose.EMAIL_CHANGE, {
      subject: 'Verify your new email address',
      buildHtml: ({ otp }) => `<p>${otp}</p>`,
    });

    expect(prisma.otpCode.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        purpose: OTPPurpose.EMAIL_CHANGE,
        usedAt: null,
      },
      data: { usedAt: expect.any(Date) },
    });
    expect(mailQueue.enqueue).toHaveBeenCalledWith(
      'new@example.com',
      'Verify your new email address',
      expect.any(String),
    );
  });

  it('consumes OTPs by userId against the latest active record', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      firstName: 'Ise',
      lastName: 'Afolayan',
    });
    prisma.otpCode.findFirst.mockResolvedValue({
      id: 'otp-1',
      codeHash: await hashValue('123456'),
    });
    prisma.otpCode.update.mockResolvedValue({ id: 'otp-1' });

    const user = await service.consumeOtpByUserId('user-1', OTPPurpose.EMAIL_CHANGE, '123456');

    expect(user).toEqual(
      expect.objectContaining({
        id: 'user-1',
        email: 'user@example.com',
      }),
    );
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp-1' },
      data: { usedAt: expect.any(Date) },
    });
  });
});
