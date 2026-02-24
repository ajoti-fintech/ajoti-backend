import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { NotificationService } from './notification.service';
import {
  EmailVerifiedPayload,
  KycStatusChangedPayload,
  PasswordChangedPayload,
  PasswordResetPayload,
  UserRegisteredPayload,
  WalletTransactionPayload,
} from './notitication.types';

@Controller()
export class NotificationConsumer {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(private readonly notificationService: NotificationService) {}

  // ─── Auth Events ──────────────────────────────────────────────────────────

  @EventPattern('auth.user.registered')
  async handleUserRegistered(@Payload() data: UserRegisteredPayload) {
    this.logger.log(`Handling auth.user.registered for userId=${data.userId}`);

    await Promise.all([
      // Email: welcome email
      this.notificationService.sendWelcomeEmail(data.userId, data.email, data.fullName),

      // In-app: welcome notification
      this.notificationService.createInAppNotification(
        data.userId,
        'Welcome to Ajoti!',
        'Your account has been created. Verify your email to get started.',
      ),
    ]);
  }

  @EventPattern('auth.email.verified')
  async handleEmailVerified(@Payload() data: EmailVerifiedPayload) {
    this.logger.log(`Handling auth.email.verified for userId=${data.userId}`);

    await Promise.all([
      // Email: account activated
      this.notificationService.sendAccountActivationEmail(data.userId, data.email, data.fullName),

      // In-app: prompt KYC
      this.notificationService.createInAppNotification(
        data.userId,
        'Email Verified ✅',
        'Your email is verified. Complete KYC verification to unlock all features.',
      ),
    ]);
  }

  @EventPattern('auth.password.reset')
  async handlePasswordReset(@Payload() data: PasswordResetPayload) {
    this.logger.log(`Handling auth.password.reset for userId=${data.userId}`);

    await Promise.all([
      this.notificationService.sendPasswordResetConfirmationEmail(
        data.userId,
        data.email,
        data.fullName,
      ),
      this.notificationService.createInAppNotification(
        data.userId,
        'Password Reset',
        "Your password was reset successfully. If this wasn't you, contact support immediately.",
      ),
    ]);
  }

  @EventPattern('auth.password.changed')
  async handlePasswordChanged(@Payload() data: PasswordChangedPayload) {
    this.logger.log(`Handling auth.password.changed for userId=${data.userId}`);

    await Promise.all([
      this.notificationService.sendPasswordChangedEmail(data.userId, data.email, data.fullName),
      this.notificationService.createInAppNotification(
        data.userId,
        'Password Changed',
        "Your password was changed. If this wasn't you, contact support immediately.",
      ),
    ]);
  }

  // ─── KYC Events ───────────────────────────────────────────────────────────

  @EventPattern('kyc.status.changed')
  async handleKycStatusChanged(@Payload() data: KycStatusChangedPayload) {
    this.logger.log(`Handling kyc.status.changed for userId=${data.userId}, status=${data.status}`);

    await Promise.all([
      this.notificationService.sendKycStatusEmail(
        data.userId,
        data.email,
        data.fullName,
        data.status,
        data.reason,
      ),
      this.notificationService.createInAppNotification(
        data.userId,
        data.status === 'APPROVED' ? 'KYC Approved ✅' : 'KYC Requires Attention',
        data.status === 'APPROVED'
          ? 'Your identity has been verified. All features are now unlocked.'
          : `Your KYC was not approved. ${data.reason ?? 'Please resubmit your documents.'}`,
      ),
    ]);
  }

  // ─── Wallet Events ────────────────────────────────────────────────────────

  @EventPattern('wallet.transaction.completed')
  async handleTransactionCompleted(@Payload() data: WalletTransactionPayload) {
    this.logger.log(
      `Handling wallet.transaction.completed for userId=${data.userId}, ref=${data.reference}`,
    );

    await Promise.all([
      this.notificationService.sendTransactionEmail(
        data.userId,
        data.email,
        data.fullName,
        data.type,
        data.amount,
        data.currency,
        data.reference,
      ),
      this.notificationService.createInAppNotification(
        data.userId,
        data.type === 'CREDIT'
          ? `You received ${data.currency} ${data.amount.toLocaleString()}`
          : `You sent ${data.currency} ${data.amount.toLocaleString()}`,
        `Transaction reference: ${data.reference}`,
      ),
    ]);
  }
}
