export const FUNDING_RECONCILIATION_QUEUE = 'funding-reconciliation-queue';

export const FundingReconciliationJobName = {
  VERIFY_PENDING: 'funding.verify-pending',
} as const;

export interface FundingReconciliationJobData {
  reference: string;
}
