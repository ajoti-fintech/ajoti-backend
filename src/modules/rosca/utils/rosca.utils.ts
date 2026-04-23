// src/modules/rosca/utils/rosca.utils.ts
import { BadRequestException } from '@nestjs/common';

/**
 * Collateral is fixed at 10% of the contribution amount platform-wide.
 * All arithmetic stays in BigInt to avoid Number precision loss.
 */
export function calculateCollateral(contributionAmount: bigint): bigint {
  return (contributionAmount * 10n) / 100n;
}

/**
 * Safely converts a user-supplied number or string to BigInt.
 * Throws a descriptive BadRequestException on failure.
 */
export function parseBigInt(value: number | string, fieldName: string): bigint {
  let amount: bigint;
  try {
    amount = BigInt(value);
  } catch {
    throw new BadRequestException(`${fieldName} must be a valid integer string (Kobo)`);
  }
  if (amount <= 0n) {
    throw new BadRequestException(`${fieldName} must be greater than zero`);
  }
  return amount;
}
