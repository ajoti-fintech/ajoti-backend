-- Add PLATFORM_FEE to LedgerSourceType enum
-- Used for the 2% company fee credit back to PLATFORM_POOL on non-loan payouts.
ALTER TYPE "LedgerSourceType" ADD VALUE 'PLATFORM_FEE';
