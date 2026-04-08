export const AUTH_EVENTS_QUEUE = 'auth-events-queue';

export const AuthJobName = {
  USER_REGISTERED: 'user.registered',
  EMAIL_VERIFIED: 'email.verified',
  PASSWORD_RESET: 'auth.password.reset',
  PASSWORD_CHANGED: 'auth.password.changed',
  KYC_STATUS_CHANGED: 'kyc.status.changed',
  WALLET_TRANSACTION_COMPLETED: 'wallet.transaction.completed',
} as const;
