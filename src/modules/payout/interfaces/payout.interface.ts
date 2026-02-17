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
  amount: string; // string for JSON safety (BigInt → string)
  isLastCycle: boolean;
  recipientId: string;
  status: 'COMPLETED' | 'PROCESSING' | 'FAILED';
  // Optional: add processedAt, internalReference, etc. if needed downstream
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
