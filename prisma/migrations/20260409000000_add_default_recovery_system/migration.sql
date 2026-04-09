-- Migration: add_default_recovery_system
-- Adds schema support for missed payout detection, collateral seizure,
-- liquidity bridge, held payout recovery, and debt tracking.

-- 1. New enum values

ALTER TYPE "BucketType" ADD VALUE IF NOT EXISTS 'HELD_PAYOUT';

ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'COLLATERAL_SEIZURE';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'LIQUIDITY_BRIDGE';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'BRIDGE_REPAYMENT';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'DEBT_REPAYMENT';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'HELD_PAYOUT_DEPOSIT';
ALTER TYPE "LedgerSourceType" ADD VALUE IF NOT EXISTS 'HELD_PAYOUT_RELEASE';

ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'DEFAULTED';

-- 2. New columns on rosca_memberships

ALTER TABLE "rosca_memberships"
  ADD COLUMN IF NOT EXISTS "has_received_payout"    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "payout_locked"           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "circle_join_restricted"  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "defaulted_at"            TIMESTAMP(3);

-- 3. New enum: DebtStatus

DO $$ BEGIN
  CREATE TYPE "DebtStatus" AS ENUM ('OUTSTANDING', 'PARTIALLY_REPAID', 'SETTLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. New table: missed_contribution_debts

CREATE TABLE IF NOT EXISTS "missed_contribution_debts" (
  "id"                    TEXT NOT NULL,
  "user_id"               TEXT NOT NULL,
  "circle_id"             TEXT NOT NULL,
  "membership_id"         TEXT NOT NULL,
  "cycle_number"          INTEGER NOT NULL,

  -- Debt components (kobo)
  "missed_amount"         BIGINT NOT NULL,
  "interest_amount"       BIGINT NOT NULL DEFAULT 0,
  "bridge_amount"         BIGINT NOT NULL DEFAULT 0,
  "collateral_deficit"    BIGINT NOT NULL DEFAULT 0,

  -- Repayment progress (kobo)
  "repaid_contribution"   BIGINT NOT NULL DEFAULT 0,
  "repaid_interest"       BIGINT NOT NULL DEFAULT 0,
  "repaid_bridge"         BIGINT NOT NULL DEFAULT 0,
  "repaid_collateral"     BIGINT NOT NULL DEFAULT 0,

  "is_post_payout_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "status"                "DebtStatus" NOT NULL DEFAULT 'OUTSTANDING',

  "settled_at"            TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "missed_contribution_debts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "missed_contribution_debts_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "missed_contribution_debts_circle_id_fkey"
    FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "missed_contribution_debts_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "rosca_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "missed_contribution_debts_user_id_status_idx"
  ON "missed_contribution_debts"("user_id", "status");

CREATE INDEX IF NOT EXISTS "missed_contribution_debts_circle_id_cycle_number_idx"
  ON "missed_contribution_debts"("circle_id", "cycle_number");
