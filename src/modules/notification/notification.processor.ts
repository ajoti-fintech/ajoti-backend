import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { AUTH_EVENTS_QUEUE, AuthJobName } from '../auth/auth.events';
import {
  EmailVerifiedPayload,
  KycStatusChangedPayload,
  PasswordChangedPayload,
  PasswordResetPayload,
  UserRegisteredPayload,
  WalletTransactionPayload,
} from './notitication.types';

@Processor(AUTH_EVENTS_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(private readonly notificationService: NotificationService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case AuthJobName.USER_REGISTERED:
        return this.handleUserRegistered(job.data);

      case AuthJobName.EMAIL_VERIFIED:
        return this.handleEmailVerified(job.data);

      case AuthJobName.PASSWORD_RESET:
        return this.handlePasswordReset(job.data);

      case AuthJobName.PASSWORD_CHANGED:
        return this.handlePasswordChanged(job.data);

      case AuthJobName.KYC_STATUS_CHANGED:
        return this.handleKycStatusChanged(job.data);

      case AuthJobName.WALLET_TRANSACTION_COMPLETED:
        return this.handleTransactionCompleted(job.data);

      default:
        // Jobs meant for other processors (e.g. kyc.processor) share this
        // queue — silently ignore unrecognised names.
        break;
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async handleUserRegistered(data: UserRegisteredPayload) {
    this.logger.log(`user.registered for userId=${data.userId}`);
    await Promise.all([
      this.notificationService.sendWelcomeEmail(data.userId, data.email, data.fullName),
      this.notificationService.createInAppNotification(
        data.userId,
        'Welcome to Ajoti!',
        'Your account has been created. Verify your email to get started.',
      ),
    ]);
  }

  private async handleEmailVerified(data: EmailVerifiedPayload) {
    this.logger.log(`email.verified for userId=${data.userId}`);
    await Promise.all([
      this.notificationService.sendAccountActivationEmail(data.userId, data.email, data.fullName),
      this.notificationService.createInAppNotification(
        data.userId,
        'Email Verified ✅',
        'Your email is verified. Complete KYC verification to unlock all features.',
      ),
    ]);
  }

  private async handlePasswordReset(data: PasswordResetPayload) {
    this.logger.log(`auth.password.reset for userId=${data.userId}`);
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

  private async handlePasswordChanged(data: PasswordChangedPayload) {
    this.logger.log(`auth.password.changed for userId=${data.userId}`);
    await Promise.all([
      this.notificationService.sendPasswordChangedEmail(data.userId, data.email, data.fullName),
      this.notificationService.createInAppNotification(
        data.userId,
        'Password Changed',
        "Your password was changed. If this wasn't you, contact support immediately.",
      ),
    ]);
  }

  private async handleKycStatusChanged(data: KycStatusChangedPayload) {
    this.logger.log(`kyc.status.changed for userId=${data.userId}, status=${data.status}`);
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

  private async handleTransactionCompleted(data: WalletTransactionPayload) {
    this.logger.log(`wallet.transaction.completed for userId=${data.userId}, ref=${data.reference}`);
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
