export enum NotificationType {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

// Kafka Event Payloads
export interface UserRegisteredPayload {
  userId: string;
  email: string;
  fullName: string;
  timestamp: string;
}

export interface EmailVerifiedPayload {
  userId: string;
  email: string;
  fullName: string;
  timestamp: string;
}

export interface PasswordResetPayload {
  userId: string;
  email: string;
  fullName: string;
  timestamp: string;
}

export interface PasswordChangedPayload {
  userId: string;
  email: string;
  fullName: string;
  timestamp: string;
}

export interface KycStatusChangedPayload {
  userId: string;
  email: string;
  fullName: string;
  status: 'APPROVED' | 'REJECTED';
  reason?: string;
  timestamp: string;
}

export interface WalletTransactionPayload {
  userId: string;
  email: string;
  fullName: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  currency: string;
  reference: string;
  timestamp: string;
}
