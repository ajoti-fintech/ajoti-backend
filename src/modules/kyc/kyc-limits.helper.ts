/**
 * CBN-compliant KYC tier transaction limits (all values in kobo, 1 NGN = 100 kobo).
 *
 * Level 0 — no KYC: no transactions allowed
 * Level 1 — NIN + BVN + NOK (auto-approved): ₦50,000 single / ₦300,000 daily
 * Level 2 — + Gov ID (superadmin review):     ₦100,000 single / ₦500,000 daily
 * Level 3 — + Proof of Address (superadmin):  ₦5,000,000 single / ₦25,000,000 daily
 */
export const KYC_SINGLE_LIMITS_KOBO: Record<number, bigint> = {
  0: 0n,
  1: 5_000_000n,   // ₦50,000
  2: 10_000_000n,  // ₦100,000
  3: 500_000_000n, // ₦5,000,000
};

export const KYC_DAILY_LIMITS_KOBO: Record<number, bigint> = {
  0: 0n,
  1: 30_000_000n,   // ₦300,000
  2: 50_000_000n,   // ₦500,000
  3: 2_500_000_000n, // ₦25,000,000
};

/**
 * Returns the single-transaction limit in kobo for a given KYC level.
 * Any level above 3 gets the Level 3 limit.
 */
export function getSingleLimitKobo(kycLevel: number): bigint {
  return KYC_SINGLE_LIMITS_KOBO[kycLevel] ?? KYC_SINGLE_LIMITS_KOBO[3];
}

/**
 * Returns the daily limit in kobo for a given KYC level.
 */
export function getDailyLimitKobo(kycLevel: number): bigint {
  return KYC_DAILY_LIMITS_KOBO[kycLevel] ?? KYC_DAILY_LIMITS_KOBO[3];
}

/**
 * Format kobo as a human-readable Naira string for error messages.
 */
export function formatNaira(kobo: bigint): string {
  return `₦${(Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}
