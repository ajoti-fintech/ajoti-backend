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
import { InjectQueue } from '@nestjs/bullmq';
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
import { Queue } from 'bullmq';
import { StringValue } from 'ms';
import { resetPasswordOtpTemplate } from '../mail/templates/otp-reset-password';
import { verificationOtpTemplate } from '../mail/templates/otp-verification';
import { OtpService } from '../otp/otp.service';
import { AUTH_EVENTS_QUEUE } from './auth.events';

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

  private async issueTokens(userId: string, role: Role) {
    // 1. ENFORCE SINGLE SESSION: Revoke all existing non-revoked tokens for this user
    // This ensures that logging in on Device B kicks the user off Device A.
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    // 2. Access Token Generation
    const accessExpires = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') || '30m';
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessExpires as StringValue,
      },
    );

    // 3. Refresh Token Generation (Rotation ready)
    const refreshRaw = crypto.randomBytes(48).toString('hex');
    const refreshHash = sha256(refreshRaw);

    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const days = Number(refreshExpiresIn.toLowerCase().replace(/[^0-9]/g, '')) || 7;
    const refreshExpires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    // 4. Store the NEW valid session
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

    // 1. Find the token and ensure it's still valid
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

    // 2. Just issue the new pair.
    // Since issueTokens() has the 'updateMany' logic, it will
    // automatically revoke this 'storedToken' along with any others.
    return this.issueTokens(storedToken.user.id, storedToken.user.role);
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
        role: registerDto.role,
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

    await this.authEventsQueue.add(
      'user.registered',
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

    return { message: 'Registered, OTP sent to mail', userId: user.id };
  }

  async registerAdmin(registerDto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
      select: { id: true, role: true },
    });

    const passwordHash = await hashValue(registerDto.password);
    const dob = new Date(`${registerDto.dob}T00:00:00.000Z`);

    let user: { id: string; email: string };

    if (!existing) {
      // Case 1: not on the system -> create as ADMIN
      user = await this.prisma.user.create({
        data: {
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          email: registerDto.email,
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
      // Case 2: already on the system -> upgrade to ADMIN
      if (existing.role === Role.ADMIN) {
        throw new BadRequestException('User is already an admin');
      }

      // IMPORTANT:
      // Decide if you want to overwrite profile fields + password or not.
      // Below: we upgrade role + optionally update details.
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          role: Role.ADMIN,
          // optional updates (only if you want admin registration to refresh these)
          firstName: registerDto.firstName,
          lastName: registerDto.lastName,
          dob,
          gender: registerDto.gender,
          phone: registerDto.phone,
          password: passwordHash,
          // create these only if they don't exist
          profile: { connectOrCreate: { where: { userId: existing.id }, create: {} } },
          kyc: { connectOrCreate: { where: { userId: existing.id }, create: {} } },
        },
        select: { id: true, email: true },
      });
    }

    const fullName = `${registerDto.firstName} ${registerDto.lastName}`;

    await this.otpService.sendOtp(registerDto.email, OTPPurpose.VERIFICATION, {
      subject: 'Verify your email',
      buildHtml: (args) => verificationOtpTemplate(args.otp, args.expiryMinutes, fullName),
    });

    await this.authEventsQueue.add(
      'user.registered',
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

    await this.authEventsQueue.add(
      'email.verified',
      {
        userId: user.id,
        email: user.email,
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
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await verifyHash(password, user.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (!user.isVerified) {
      throw new ForbiddenException('Email not verified');
    }

    const tokens = await this.issueTokens(user.id, user.role);

    await this.authEventsQueue.add(
      'user.logged-in',
      {
        userId: user.id,
        email: user.email,
        timestamp: new Date().toISOString(),
      },
      {
        removeOnComplete: true,
        attempts: 5,
      },
    );

    return {
      // message: 'Logged in',
      // user: { id: user.id, email: user.email, role: user.role },
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

    await this.authEventsQueue.add(
      'auth.password.reset',
      {
        userId: user.id,
        email: user.email,
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

    // revoke existing refresh tokens (forces re-login everywhere)
    await this.prisma.refreshToken.updateMany({
      where: { userId: userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.authEventsQueue.add(
      'auth.password.changed',
      {
        userId: user.id,
        email: user.email,
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
