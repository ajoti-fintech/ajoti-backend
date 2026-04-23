// src/modules/payout/interfaces/payout.interface.ts
import { RoscaCircle, RoscaCycleSchedule, User } from '@prisma/client';

/**
 * Context needed to execute a payout
 * Passed into processPayout transaction
 */
export interface PayoutContext {
  circle: RoscaCircle;
  schedule: RoscaCycleSchedule;
  cycleNumber: number;
  recipientId: string;
  potAmount: bigint; // total amount to transfer (contributions + penalties)
}

/**
 * Successful payout result shape
 */
export interface PayoutResult {
  payoutId: string;
  amount: string;        // net amount recipient received (string for BigInt JSON safety)
  grossAmount: string;   // totalPot before fee
  platformFee: string;   // 2% company fee (0 when loanRepaid=true — loan has its own fee)
  isLastCycle: boolean;
  recipientId: string;
  status: 'COMPLETED' | 'PROCESSING' | 'FAILED';
}

/**
 * Data needed to reverse a failed payout
 * Used in reversePayout
 */
export interface PayoutReversalContext {
  originalPayoutId: string;
  reason: string;
  circleId: string;
  scheduleId: string;
  amount: bigint; // amount that was attempted
  recipientId: string;
  // Optional: add original error message, external reference, etc.
  errorMessage?: string;
}
