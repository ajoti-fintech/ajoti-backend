import { PrismaService } from '@/prisma';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Logger,
  // ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { OTPPurpose, Role } from '@prisma/client';
import { hashValue, verifyHash } from '@/common';
import * as crypto from 'crypto';
import { resetPasswordOtpTemplate } from '../mail/templates/otp-reset-password';
import { verificationOtpTemplate } from '../mail/templates/otp-verification';
import { KafkaService } from '../kafka/kafka.service';
import { OtpService } from '../otp/otp.service';

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private jwt: JwtService,
    private readonly kafkaService: KafkaService,
    private readonly otpService: OtpService,
  ) { }

  private logger = new Logger('HTTP');

  private async issueTokens(userId: string, role: Role) {
    const access = await this.jwt.signAsync(
      { sub: userId, role },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<number>('JWT_ACCESS_EXPIRES_IN') || '15m',
      },
    );

    const refreshRaw = crypto.randomBytes(48).toString('hex');
    const refreshHash = sha256(refreshRaw);

    const refreshDays = (this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d').toLowerCase();
    // quick parse: "30d" only (keep it simple)
    const days = Number(refreshDays.replace('d', '')) || 30;
    const refreshExpires = new Date(Date.now() + days * 24 * 60 * 60_000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshHash,
        expiresAt: refreshExpires,
      },
    });

    return { accessToken: access, refreshToken: refreshRaw };
  }

  async register(registerDto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: registerDto.email } });
    if (exists) throw new BadRequestException('User with email already exists');

    const passwordHash = await hashValue(registerDto.password);
    const dob = new Date(`${registerDto.dob}T00:00:00.000Z`);

    const user = await this.prisma.user.create({
      data: {
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        email: registerDto.email,
        dob,
        gender: registerDto.gender,
        phone: registerDto.phone,
        password: passwordHash,
        role: Role.MEMBER,
        profile: { create: {} },
        kyc: { create: {} },
      },
      select: { id: true, email: true },
    });

    const fullName = `${registerDto.firstName} ${registerDto.lastName}`;
    await this.otpService.sendOtp(registerDto.email, OTPPurpose.VERIFICATION, {
      subject: 'Verify your email',
      buildHtml: (args) => verificationOtpTemplate(args.otp, args.expiryMinutes, fullName),
    });

    await this.kafkaService.emit('auth.user.registered', {
      userId: user.id,
      email: user.email,
      fullName,
      timestamp: new Date().toISOString(),
    });

    return { message: 'Registered, OTP sent to mail', userId: user.id };
  }

  async resendVerificationOtp(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isVerified: true, firstName: true, lastName: true },
    });

    if (!user) return;

    if (user.isVerified) throw new BadRequestException('Email already verified');

    const fullName = `${user.firstName} ${user.lastName}`;
    await this.otpService.sendOtp(email, OTPPurpose.VERIFICATION, {
      subject: 'Verify your email',
      buildHtml: (args) => verificationOtpTemplate(args.otp, args.expiryMinutes, fullName),
    });
  }

  async resendResetPasswordOtp(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isVerified: true, firstName: true, lastName: true },
    });

    if (!user) return;

    if (user.isVerified) throw new BadRequestException('Email already verified');

    const fullName = `${user.firstName} ${user.lastName}`;
    await this.otpService.sendOtp(email, OTPPurpose.RESET_PASSWORD, {
      subject: 'Reset your password',
      buildHtml: (args) => resetPasswordOtpTemplate(args.otp, args.expiryMinutes, fullName),
    });
  }

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const user = await this.otpService.consumeOtp(
      verifyEmailDto.email,
      OTPPurpose.VERIFICATION,
      verifyEmailDto.otp,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    });

    await this.kafkaService.emit('auth.email.verified', {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    return { message: 'email verified' };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await verifyHash(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (!user.isVerified) {
      throw new ForbiddenException('Email not verified');
    }

    const tokens = await this.issueTokens(user.id, user.role);

    await this.kafkaService.emit('auth.user.logged-in', {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    return {
      user: { firstname: user.firstName, lastname: user.lastName, DOB: user.dob, },
      ...tokens,
    };
  }

  async logout(userId: string, refreshToken: string) {
    if (!refreshToken) throw new BadRequestException('refreshToken is required');
    const hash = sha256(refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Logged out' };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    // don’t leak whether email exists (optional)
    const user = await this.prisma.user.findUnique({ where: { email: forgotPasswordDto.email } });

    if (user) {
      const fullName = `${user.firstName} ${user.lastName}`;
      await this.otpService.sendOtp(forgotPasswordDto.email, OTPPurpose.RESET_PASSWORD, {
        subject: 'Reset your password',
        buildHtml: (args) => resetPasswordOtpTemplate(args.otp, args.expiryMinutes, fullName),
      });
    }

    return { message: 'If the email exists, an OTP has been sent.' };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const user = await this.otpService.consumeOtp(
      resetPasswordDto.email,
      OTPPurpose.RESET_PASSWORD,
      resetPasswordDto.otp,
    );

    const newHash = await hashValue(resetPasswordDto.newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: newHash },
    });

    // revoke all refresh tokens
    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.kafkaService.emit('auth.password.reset', {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    return { message: 'Password reset successful.' };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const ok = await verifyHash(changePasswordDto.oldPassword, user.password);
    if (!ok) throw new UnauthorizedException('Old password is wrong');

    const newHash = await hashValue(changePasswordDto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: newHash },
    });

    // revoke existing refresh tokens (forces re-login everywhere)
    await this.prisma.refreshToken.updateMany({
      where: { userId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.kafkaService.emit('auth.password.changed', {
      userId: user.id,
      email: user.email,
      timestamp: new Date().toISOString(),
    });

    return { message: 'Password changed.' };
  }
}
