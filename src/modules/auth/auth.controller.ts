import {
  Controller,
  Post,
  Body,
  BadRequestException,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LogoutDto,
  OAuthPasswordFormDto,
  RegisterDto,
  RegistrationSuccessfulDto,
  ResentOtpDto,
  ResetPasswordDto,
  VerifyEmailDto,
  VerifyEmailResponse,
} from './dto/auth.dto';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  // ApiOkResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthRequest } from '@/common/types/auth-request';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // 3 per 5 minutes
  @Post('register')
  @Throttle({ default: { ttl: 300_000, limit: 3 } })
  @ApiOperation({
    summary: 'Register a new user',
    description: 'Register a new user and send verification OTP',
  })
  @ApiAcceptedResponse({ type: RegistrationSuccessfulDto })
  @ApiConflictResponse({ description: 'User already esists' })
  @ApiBadRequestResponse({ description: 'Invalid imput' })
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('register-admin')
  @Throttle({ default: { ttl: 300_000, limit: 3 } })
  @ApiOperation({
    summary: 'Register a new admin user',
    description: 'Register a new admin user and send verification OTP',
  })
  @ApiAcceptedResponse({ type: RegistrationSuccessfulDto })
  @ApiConflictResponse({ description: 'User already esists' })
  @ApiBadRequestResponse({ description: 'Invalid imput' })
  async registerAdmin(@Body() dto: RegisterDto) {
    return this.auth.registerAdmin(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  @ApiOperation({ summary: 'Verify email', description: 'Verify email with OTP' })
  @ApiAcceptedResponse({ type: VerifyEmailResponse })
  @ApiBadRequestResponse({ example: 'Invalid' })
  async verify_email(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Post('resend-verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 3 } })
  @ApiOperation({
    summary: 'Resend verification OTP',
    description: 'Resend verification OTP to email',
  })
  @ApiOkResponse({ description: 'OTP sent' })
  @ApiBody({ type: ResentOtpDto })
  async resend_otp(@Body() dto: ResentOtpDto) {
    await this.auth.resendVerificationOtp(dto.email);
    return { message: 'If email exists, an OTP has been sent' };
  }

  @Post('/token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  @ApiOperation({
    summary: 'Login',
    description: 'Login with email and password and get access and refresh tokens',
  })
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiBody({ type: OAuthPasswordFormDto })
  @ApiOkResponse({ description: 'Token issued' })
  async login(@Body() form: OAuthPasswordFormDto) {
    if (form.grant_type !== 'password') {
      throw new BadRequestException('Unsupported grant_type');
    }
    return this.auth.login(form.email, form.password);
  }

  @ApiBearerAuth('access-token')
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @ApiOperation({ summary: 'Logout', description: 'Logout and invalidate refresh token' })
  @ApiOkResponse({ description: 'logged out' })
  async logout(@Request() req: AuthRequest, @Body() dto: LogoutDto) {
    if (!dto?.refreshToken) throw new BadRequestException('refreshToken is required');
    return this.auth.logout(req.user.userId, dto.refreshToken);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  @ApiOperation({
    summary: 'Refresh tokens',
    description: 'Exchange a valid refresh token for a new access + refresh token pair',
  })
  @ApiBody({ type: LogoutDto })
  @ApiOkResponse({ description: 'New token pair issued' })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: LogoutDto) {
    return this.auth.refreshTokens(dto.refreshToken);
  }

  @Post('forget-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOperation({ summary: 'Forgot password', description: 'Send reset password OTP to email' })
  @ApiOkResponse({ description: 'OTP Sent' })
  async forgot_password(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @Post('resend-reset-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 3 } })
  @ApiOperation({
    summary: 'Resend reset password OTP',
    description: 'Resend reset password OTP to email',
  })
  @ApiOkResponse({ description: 'OTP sent' })
  @ApiBody({ type: ResentOtpDto })
  async resend_reset_otp(@Body() dto: ResentOtpDto) {
    await this.auth.resendResetPasswordOtp(dto.email);
    return { message: 'If email exists, an OTP has been sent' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOperation({ summary: 'Reset password', description: 'Reset password with OTP' })
  @ApiOkResponse({ description: 'Password reset successful' })
  async reset_password(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @ApiBearerAuth('access-token')
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOperation({
    summary: 'Change password',
    description: 'Change password with current password',
  })
  @ApiOkResponse({ description: 'Password change successful' })
  async change_password(@Request() req: AuthRequest, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.userId, dto);
  }
}
