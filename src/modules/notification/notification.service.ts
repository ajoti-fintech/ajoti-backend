import { PrismaService } from '@/prisma';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { NotificationType } from './notitication.types';
import { NotificationStatus } from '@prisma/client';
import { welcomeEmailTemplate } from '../mail/templates/welcome-email';
import { accountActivationTemplate } from '../mail/templates/account-activation';
import { passwordResetTemplate } from '../mail/templates/password-reset';
import { passwordChangedTemplate } from '../mail/templates/password-change';
import { kycStatusTemplate } from '../mail/templates/kyc-status';
import { transactionTemplate } from '../mail/templates/transaction';
import { payoutPositionTemplate } from '../mail/templates/payout-position';
import { contributionReminderTemplate } from '../mail/templates/contribution-reminder';
import { memberApprovedTemplate } from '../mail/templates/member-approved';
import { memberRejectedTemplate } from '../mail/templates/member-rejected';
import { circleStartedTemplate } from '../mail/templates/circle-started';
import { topUpReminderTemplate } from '../mail/templates/top-up-reminder';
import { NotificationGateway } from './notification-gateway';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(forwardRef(() => NotificationGateway))
    private readonly gateway: NotificationGateway,
  ) {}

  /**
   * Persist a notification record in the database
   * Always call this before sending so we have an audit trail
   * even if delivery fails
   */
  private async createRecord(params: CreateNotificationParams) {
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        status: NotificationStatus.PENDING,
      },
    });
  }

  private async markSent(id: string) {
    await this.prisma.notification.update({
      where: { id },
      data: { status: NotificationStatus.SENT, sentAt: new Date() },
    });
  }

  private async markFailed(id: string, error: string) {
    await this.prisma.notification.update({
      where: { id },
      data: { status: NotificationStatus.FAILED, error },
    });
  }

  // Email notifications
  async sendWelcomeEmail(userId: string, email: string, fullName: string) {
    const record = await this.createRecord({
      userId,
      type: NotificationType.EMAIL,
      title: 'Welcome to Ajoti!',
      body: `Welcome email sent to ${email}`,
    });

    const subject = 'Welcome to Ajoti!';
    const html = welcomeEmailTemplate(fullName);

    try {
      await this.mail.send(email, subject, html);
      await this.markSent(record.id);
      this.logger.log(`Welcome email sent to ${email} (notificationId: ${record.id})`);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  async sendAccountActivationEmail(userId: string, email: string, fullName: string) {
    const record = await this.createRecord({
      userId,
      type: NotificationType.EMAIL,
      title: 'Account Activated',
      body: `Account activation email sent to ${email}`,
    });

    const subject = 'Your Ajoti Account is Now Activated!';
    const html = accountActivationTemplate(fullName);

    try {
      await this.mail.send(email, subject, html);
      await this.markSent(record.id);
      this.logger.log(`Account activation email sent to ${email} (notificationId: ${record.id})`);
    } catch (error) {
      this.logger.error(`Failed to send account activation email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  async sendPasswordResetConfirmationEmail(userId: string, email: string, fullName: string) {
    const record = await this.createRecord({
      userId,
      type: NotificationType.EMAIL,
      title: 'Password Reset Successful',
      body: `Password reset email sent to ${email}`,
    });

    const subject = 'Your Ajoti Password Has Been Reset';
    const html = passwordResetTemplate(fullName);

    try {
      await this.mail.send(email, subject, html);
      await this.markSent(record.id);
      this.logger.log(`Password reset email sent to ${email} (notificationId: ${record.id})`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  async sendPasswordChangedEmail(userId: string, email: string, fullName: string) {
    const record = await this.createRecord({
      userId,
      type: NotificationType.EMAIL,
      title: 'Password Changed',
      body: `Password changed email sent to ${email}`,
    });

    const subject = 'Your Ajoti Password Has Been Changed';
    const html = passwordChangedTemplate(fullName);

    try {
      await this.mail.send(email, subject, html);
      await this.markSent(record.id);
      this.logger.log(`Password changed email sent to ${email} (notificationId: ${record.id})`);
    } catch (error) {
      this.logger.error(`Failed to send password changed email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  async sendKycStatusEmail(
    userId: string,
    email: string,
    fullName: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    const record = await this.createRecord({
      userId,
      type: NotificationType.EMAIL,
      title: `KYC ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
      body: `KYC ${status} notification sent to ${email}`,
    });

    const subject = `Your Ajoti KYC Status: ${status === 'APPROVED' ? 'Approved ✅' : 'Rejected ❌'}`;
    const html = kycStatusTemplate(fullName, status, reason);
    try {
      await this.mail.send(email, subject, html);
      await this.markSent(record.id);
      this.logger.log(`KYC status email sent to ${email} (notificationId: ${record.id})`);
    } catch (error) {
      this.logger.error(`Failed to send KYC status email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  async sendTransactionEmail(
    userId: string,
    email: string,
    fullName: string,
    type: 'CREDIT' | 'DEBIT',
    amount: number,
    currency: string,
    reference: string,
  ) {
    const title = type === 'CREDIT' ? 'Money Received' : 'Payment Sent';

    const record = await this.createRecord({
      userId,
      type: NotificationType.EMAIL,
      title,
      body: `Transaction notification for ${reference} sent to ${email}`,
    });

    try {
      const subject =
        type === 'CREDIT'
          ? `You Received ${currency} ${amount.toLocaleString()}`
          : `You Made a Payment of ${currency} ${amount.toLocaleString()}`;

      const html = transactionTemplate(fullName, type, amount, currency, reference);
      await this.mail.send(email, subject, html);
      await this.markSent(record.id);
      this.logger.log(`Transaction email sent to ${email} (notificationId: ${record.id})`);
    } catch (error) {
      this.logger.error(`Failed to send transaction email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  // ----- In-App Notifications -----
  /**
   * Creates an in-app notification record.
   * This is returned via the API and pushed in real-time via WebSocket.
   */
  async createInAppNotification(userId: string, title: string, body: string) {
    const record = await this.createRecord({
      userId,
      type: NotificationType.IN_APP,
      title,
      body,
    });

    // Real-time push via WebSocket
    this.gateway.pushToUser(userId, 'notification.new', {
      id: record.id,
      title: record.title,
      body: record.body,
      createdAt: record.createdAt,
    });

    return record;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────
  async getUserNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false, type: NotificationType.IN_APP },
    });
    return { count };
  }

  async markAsRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
    return { message: 'Marked as read' };
  }

  async markAllAsRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { message: 'All notifications marked as read' };
  }

  // ── ROSCA Membership Status ───────────────────────────────────────────────

  async sendMemberApprovedNotification(
    userId: string,
    email: string,
    fullName: string,
    circleName: string,
    payoutPosition: number,
  ) {
    const title = `You've been accepted into ${circleName}`;
    const body = `Congratulations! Your request to join ${circleName} has been approved. You've been assigned payout position #${payoutPosition}.`;

    this.createInAppNotification(userId, title, body).catch((err) =>
      this.logger.error(`Failed in-app approval notification for ${userId}`, err?.stack),
    );

    const record = await this.createRecord({ userId, type: NotificationType.EMAIL, title, body });
    try {
      const html = memberApprovedTemplate(fullName, circleName, payoutPosition);
      await this.mail.send(email, title, html);
      await this.markSent(record.id);
    } catch (error) {
      this.logger.error(`Failed to send member approved email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  async sendMemberRejectedNotification(
    userId: string,
    email: string,
    fullName: string,
    circleName: string,
  ) {
    const title = `Your request to join ${circleName} was not approved`;
    const body = `Unfortunately, your request to join ${circleName} was not approved. Your reserved collateral has been returned to your wallet.`;

    this.createInAppNotification(userId, title, body).catch((err) =>
      this.logger.error(`Failed in-app rejection notification for ${userId}`, err?.stack),
    );

    const record = await this.createRecord({ userId, type: NotificationType.EMAIL, title, body });
    try {
      const html = memberRejectedTemplate(fullName, circleName);
      await this.mail.send(email, title, html);
      await this.markSent(record.id);
    } catch (error) {
      this.logger.error(`Failed to send member rejected email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  // ── Circle Started ────────────────────────────────────────────────────────

  async sendCircleStartedNotification(
    userId: string,
    email: string,
    fullName: string,
    circleName: string,
    firstDeadline: string,
    contributionAmount: string,
    payoutPosition: number,
  ) {
    const title = `${circleName} has started!`;
    const body = `Your savings circle ${circleName} is now active. First contribution of ₦${contributionAmount} is due by ${firstDeadline}. Your payout position is #${payoutPosition}.`;

    this.createInAppNotification(userId, title, body).catch((err) =>
      this.logger.error(`Failed in-app circle-started notification for ${userId}`, err?.stack),
    );

    const record = await this.createRecord({ userId, type: NotificationType.EMAIL, title, body });
    try {
      const html = circleStartedTemplate(fullName, circleName, firstDeadline, contributionAmount, payoutPosition);
      await this.mail.send(email, title, html);
      await this.markSent(record.id);
    } catch (error) {
      this.logger.error(`Failed to send circle-started email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  // ── Top-up Reminder ───────────────────────────────────────────────────────

  async sendTopUpReminderNotification(
    userId: string,
    email: string,
    fullName: string,
    circleName: string,
    requiredNaira: string,
    availableNaira: string,
  ) {
    const title = `Top up your wallet — ${circleName}`;
    const body = `Your available balance (₦${availableNaira}) may be insufficient for your upcoming contribution of ₦${requiredNaira} to ${circleName}. Please top up your wallet.`;

    this.createInAppNotification(userId, title, body).catch((err) =>
      this.logger.error(`Failed in-app top-up notification for ${userId}`, err?.stack),
    );

    const record = await this.createRecord({ userId, type: NotificationType.EMAIL, title, body });
    try {
      const html = topUpReminderTemplate(fullName, circleName, requiredNaira, availableNaira);
      await this.mail.send(email, title, html);
      await this.markSent(record.id);
    } catch (error) {
      this.logger.error(`Failed to send top-up reminder email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  // ── Contribution Reminder ────────────────────────────────────────────────

  async sendContributionReminder(
    userId: string,
    email: string,
    fullName: string,
    circleName: string,
    cycleNumber: number,
    contributionAmount: string,
    deadline: string,
  ) {
    const title = `Contribution reminder — ${circleName} cycle ${cycleNumber}`;
    const body = `You have not yet contributed for cycle ${cycleNumber} in ${circleName}. Deadline: ${deadline}.`;

    // In-app
    this.createInAppNotification(userId, title, body).catch((err) =>
      this.logger.error(`Failed in-app reminder for ${userId}`, err?.stack),
    );

    // Email
    const record = await this.createRecord({ userId, type: NotificationType.EMAIL, title, body });
    try {
      const html = contributionReminderTemplate(fullName, circleName, cycleNumber, contributionAmount, deadline);
      await this.mail.send(email, title, html);
      await this.markSent(record.id);
    } catch (error) {
      this.logger.error(`Failed to send contribution reminder email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }

  // ── Payout Position Notification ──────────────────────────────────────────
  /**
   * Send in-app + email notification when a member's payout position is
   * assigned or reassigned.
   * isReassignment = true  → admin manually changed the position
   * isReassignment = false → initial auto-assignment on approval
   */
  async sendPayoutPositionNotification(
    userId: string,
    email: string,
    fullName: string,
    circleName: string,
    position: number,
    isReassignment: boolean,
  ) {
    const title = isReassignment
      ? `Payout position updated — ${circleName}`
      : `Payout position assigned — ${circleName}`;
    const body = isReassignment
      ? `Your payout position in ${circleName} has been updated to #${position} by the admin.`
      : `You have been assigned payout position #${position} in ${circleName}.`;

    // In-app notification (fire-and-forget, don't block the caller)
    this.createInAppNotification(userId, title, body).catch((err) =>
      this.logger.error(`Failed to create in-app notification for ${userId}`, err?.stack),
    );

    // Email
    const record = await this.createRecord({
      userId,
      type: NotificationType.EMAIL,
      title,
      body,
    });

    try {
      const html = payoutPositionTemplate(fullName, circleName, position, isReassignment);
      await this.mail.send(email, title, html);
      await this.markSent(record.id);
    } catch (error) {
      this.logger.error(`Failed to send payout position email to ${email}`, error?.stack);
      await this.markFailed(record.id, error?.message);
    }
  }
}
