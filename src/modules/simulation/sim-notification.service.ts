// src/modules/simulation/sim-notification.service.ts
/**
 * No-op NotificationService for simulation runs.
 *
 * Simulations create dozens of fake users and fire the same lifecycle events
 * (member approved, circle started, payout, …) that real users trigger. We
 * don't want to hit the mail provider rate limit, write notification rows to
 * any database, or push WebSocket events for synthetic data.
 *
 * Every method is a silent no-op. Query methods return safe empty values so
 * that any caller expecting a result (e.g. getUnreadCount) doesn't crash.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class SimNotificationService {
  async sendWelcomeEmail() {}
  async sendAccountActivationEmail() {}
  async sendPasswordResetConfirmationEmail() {}
  async sendPasswordChangedEmail() {}
  async sendKycStatusEmail() {}
  async sendTransactionEmail() {}

  async createInAppNotification() {
    return undefined as any;
  }

  async getUserNotifications() {
    return { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } };
  }

  async getUnreadCount() {
    return { count: 0 };
  }

  async markAsRead() {
    return { message: 'Marked as read' };
  }

  async markAllAsRead() {
    return { message: 'All notifications marked as read' };
  }

  async sendMemberApprovedNotification() {}
  async sendMemberRejectedNotification() {}
  async sendCircleStartedNotification() {}
  async sendTopUpReminderNotification() {}
  async sendContributionReminder() {}
  async sendPayoutPositionNotification() {}
}
