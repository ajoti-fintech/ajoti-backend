import { PrismaService } from '@/prisma';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OTPPurpose } from '@prisma/client';
import { generateOtpCode, hashValue, verifyHash } from '@/common';
import { MailErrorMapper } from '@/common/error/mail-error';
import { MailQueue } from '../mail/mail.queue';

type SendOtpOptions = {
  subject: string;
  /**
   * Build the email html. We pass otp + expiryMinutes so callers can reuse it.
   */
  buildHtml: (args: { otp: string; expiryMinutes: number }) => string;
};

@Injectable()
export class OtpService {
  private logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailQueue: MailQueue,
    private readonly mailErrorMapper: MailErrorMapper,
  ) {}

  private otpExpiresAt() {
    const mins = Number(this.config.get<string>('OTP_EXPIRES_MINUTES') || '10');
    return new Date(Date.now() + mins * 60_000);
  }

  private otpExpiryMinutes() {
    return Number(this.config.get<string>('OTP_EXPIRES_MINUTES') || '10');
  }

  async sendOtp(email: string, purpose: OTPPurpose, options: SendOtpOptions) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    await this.prisma.otpCode.updateMany({
      where: { userId: user.id, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });

    const otp = generateOtpCode(6);
    const codeHash = await hashValue(otp);

    await this.prisma.otpCode.create({
      data: {
        userId: user.id,
        purpose,
        codeHash,
        expiresAt: this.otpExpiresAt(),
      },
    });

    const expiryMinutes = this.otpExpiryMinutes();
    const html = options.buildHtml({ otp, expiryMinutes });

    try {
      await this.mailQueue.enqueue(email, options.subject, html);
    } catch (err: any) {
      this.logger.error('OTP email failed', err?.stack || err);
      this.mailErrorMapper.map(err);
    }

    return { message: 'OTP Sent' };
  }

  async consumeOtp(email: string, purpose: OTPPurpose, otp: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const record = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        purpose,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) throw new BadRequestException('Invalid or expired OTP');

    const ok = await verifyHash(otp, record.codeHash);
    if (!ok) throw new BadRequestException('Invalid or expired OTP');

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    return user;
  }
}
