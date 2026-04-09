import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { OTPPurpose, Prisma, Role } from '@prisma/client';
import { hashValue, normalizeEmail, verifyHash } from '@/common';
import * as crypto from 'crypto';
import { Queue } from 'bullmq';
import { StringValue } from 'ms';
import { resetPasswordOtpTemplate } from '../mail/templates/otp-reset-password';
import { verificationOtpTemplate } from '../mail/templates/otp-verification';
import { OtpService } from '../otp/otp.service';
import { AUTH_EVENTS_QUEUE, AuthJobName } from './auth.events';
import { PrismaService } from '@/prisma';

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private jwt: JwtService,
    private readonly otpService: OtpService,
    @InjectQueue(AUTH_EVENTS_QUEUE) private readonly authEventsQueue: Queue,
  ) {}

  private logger = new Logger('HTTP');

  private async findActiveUserByEmail<T extends Prisma.UserSelect>(
    email: string,
    select: T,
  ): Promise<Prisma.UserGetPayload<{ select: T }> | null> {
    return this.prisma.user.findFirst({
      where: {
        email: {
          equals: normalizeEmail(email),
          mode: 'insensitive',
        },
      },
      select,
    });
  }

  private async findUserByAnyEmail<T extends Prisma.UserSelect>(
    email: string,
    select: T,
  ): Promise<Prisma.UserGetPayload<{ select: T }> | null> {
    return this.prisma.user.findFirst({
      where: {
        OR: [
          {
            email: {
              equals: normalizeEmail(email),
              mode: 'insensitive',
            },
          },
          {
            pendingEmail: {
              equals: normalizeEmail(email),
              mode: 'insensitive',
            },
          },
        ],
      },
      select,
    });
  }

  private async issueTokens(userId: string, role: Role) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    const accessExpires = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '1h';
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessExpires as StringValue,
      },
    );

    const refreshRaw = crypto.randomBytes(48).toString('hex');
    const refreshHash = sha256(refreshRaw);

    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '30d';
    const days = Number(refreshExpiresIn.toLowerCase().replace(/[^0-9]/g, '')) || 7;
    const refreshExpires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshHash,
        expiresAt: refreshExpires,
      },
    });

    return {
      accessToken,
      refreshToken: refreshRaw,
      expiresIn: accessExpires,
    };
  }

  async refreshTokens(refreshToken: string) {
    if (!refreshToken) throw new BadRequestException('Refresh token is required');

    const tokenHash = sha256(refreshToken);

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.issueTokens(storedToken.user.id, storedToken.user.role);
  }

  async register(registerDto: RegisterDto) {
    const normalizedEmail = normalizeEmail(registerDto.email);
    const exists = await this.findUserByAnyEmail(normalizedEmail, {
      id: true,
    });
    if (exists) throw new BadRequestException('User with email already exists');

    const passwordHash = await hashValue(registerDto.password);
    const dob = new Date(`${registerDto.dob}T00:00:00.000Z`);

    const user = await this.prisma.user.create({
      data: {
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        email: normalizedEmail,
        dob,
        gender: registerDto.gender,
        phone: registerDto.phone,
        password: passwordHash,
        role: registerDto.role,
        profile: { create: {} },
        kyc: { create: {} },
      },
      select: { id: true, email: true },
    });

    const fullName = `${registerDto.firstName} ${registerDto.lastName}`;
    await this.otpService.sendOtp(normalizedEmail, OTPPurpose.VERIFICATION, {
      subject: 'Verify your email',
      buildHtml: (args) => verificationOtpTemplate(args.otp, args.expiryMinutes, fullName),
    });

    await this.authEventsQueue.add(
      AuthJobName.USER_REGISTERED,
      {
        userId: user.id,
        email: user.email,
        fullName,
        timestamp: new Date().toISOString(),
      },
      {
        removeOnComplete: true,
        attempts: 5,
      },
    );

    return { message: 'Registered, OTP sent to mail', userEmail: user.email };
  }

  async registerAdmin(registerDto: RegisterDto) {
    const normalizedEmail = normalizeEmail(registerDto.email);
    const existing = await this.findUserByAnyEmail(normalizedEmail, {
      id: true,
      role: true,
      email: true,
      pendingEmail: true,
    });

    const passwordHash = await hashValue(registerDto.password);
    const dob = new Date(`${registerDto.dob}T00:00:00.000Z`);

    let user: { id: string; email: string };

    if (!existing) {
      user = await this.prisma.user.create({
        data: {
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          email: normalizedEmail,
          dob,
          gender: registerDto.gender,
          phone: registerDto.phone,
          password: passwordHash,
          role: Role.ADMIN,
          profile: { create: {} },
          kyc: { create: {} },
        },
        select: { id: true, email: true },
      });
    } else {
      if (normalizeEmail(existing.email) !== normalizedEmail) {
        throw new BadRequestException('User with email already exists');
      }

      if (existing.role === Role.ADMIN) {
        throw new BadRequestException('User is already an admin');
      }

      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          role: Role.ADMIN,
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          dob,
          gender: registerDto.gender,
          phone: registerDto.phone,
          password: passwordHash,
          profile: { connectOrCreate: { where: { userId: existing.id }, create: {} } },
          kyc: { connectOrCreate: { where: { userId: existing.id }, create: {} } },
        },
        select: { id: true, email: true },
      });
    }

    const fullName = `${registerDto.firstName} ${registerDto.lastName}`;

    await this.otpService.sendOtp(normalizedEmail, OTPPurpose.VERIFICATION, {
      subject: 'Verify your email',
      buildHtml: (args) => verificationOtpTemplate(args.otp, args.expiryMinutes, fullName),
    });

    await this.authEventsQueue.add(
      AuthJobName.USER_REGISTERED,
      {
        userId: user.id,
        email: user.email,
        fullName,
        timestamp: new Date().toISOString(),
      },
      {
        removeOnComplete: true,
        attempts: 5,
      },
    );

    return { message: 'Registered/Upgraded, OTP sent to mail', userId: user.id };
  }

  async resendVerificationOtp(email: string) {
    const user = await this.findActiveUserByEmail(email, {
      id: true,
      email: true,
      isVerified: true,
      firstName: true,
      lastName: true,
    });

    if (!user) return;

    if (user.isVerified) throw new BadRequestException('Email already verified');

    const fullName = `${user.firstName} ${user.lastName}`;
    await this.otpService.sendOtp(user.email, OTPPurpose.VERIFICATION, {
      subject: 'Verify your email',
      buildHtml: (args) => verificationOtpTemplate(args.otp, args.expiryMinutes, fullName),
    });
  }

  async resendResetPasswordOtp(email: string) {
    const user = await this.findActiveUserByEmail(email, {
      id: true,
      email: true,
      isVerified: true,
      firstName: true,
      lastName: true,
    });

    if (!user) return;

    if (user.isVerified) throw new BadRequestException('Email already verified');

    const fullName = `${user.firstName} ${user.lastName}`;
    await this.otpService.sendOtp(user.email, OTPPurpose.RESET_PASSWORD, {
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

    await this.authEventsQueue.add(
      AuthJobName.EMAIL_VERIFIED,
      {
        userId: user.id,
        email: user.email,
        fullName: `${user.firstName} ${user.lastName}`,
        timestamp: new Date().toISOString(),
      },
      {
        removeOnComplete: true,
        attempts: 5,
      },
    );

    return { message: 'email verified' };
  }

  async login(email: string, password: string) {
    const user = await this.findActiveUserByEmail(email, {
      id: true,
      email: true,
      password: true,
      role: true,
      isVerified: true,
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await verifyHash(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (!user.isVerified) {
      throw new ForbiddenException('Email not verified');
    }

    const tokens = await this.issueTokens(user.id, user.role);

    return {
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
    const user = await this.findActiveUserByEmail(forgotPasswordDto.email, {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    });

    if (user) {
      const fullName = `${user.firstName} ${user.lastName}`;
      await this.otpService.sendOtp(user.email, OTPPurpose.RESET_PASSWORD, {
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

    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.authEventsQueue.add(
      AuthJobName.PASSWORD_RESET,
      {
        userId: user.id,
        email: user.email,
        fullName: `${user.firstName} ${user.lastName}`,
        timestamp: new Date().toISOString(),
      },
      {
        removeOnComplete: true,
        attempts: 5,
      },
    );

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

    await this.prisma.refreshToken.updateMany({
      where: { userId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.authEventsQueue.add(
      AuthJobName.PASSWORD_CHANGED,
      {
        userId: user.id,
        email: user.email,
        fullName: `${user.firstName} ${user.lastName}`,
        timestamp: new Date().toISOString(),
      },
      {
        removeOnComplete: true,
        attempts: 5,
      },
    );

    return { message: 'Password changed.' };
  }
}
