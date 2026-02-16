/*
  Warnings:

  - The values [TARGET_SAVINGS,FIXED_SAVINGS] on the enum `LedgerSourceType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "SystemWalletType" AS ENUM ('PLATFORM_POOL', 'RECIPIENT_BASE');

-- CreateEnum
CREATE TYPE "CycleFrequency" AS ENUM ('WEEKLY', 'BI_WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "CircleVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PayoutLogic" AS ENUM ('RANDOM_DRAW', 'SEQUENTIAL', 'TRUST_SCORE', 'COMBINED');

-- CreateEnum
CREATE TYPE "CircleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'COMPLETED', 'EXITED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('UPCOMING', 'COMPLETED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
BEGIN;
CREATE TYPE "LedgerSourceType_new" AS ENUM ('TRANSACTION', 'ROSCA_CIRCLE', 'CONTRIBUTION', 'COLLATERAL_RESERVE', 'COLLATERAL_RELEASE', 'PENALTY', 'EXIT_PENALTY', 'TRUST_ADJUSTMENT', 'ADMIN_ADJUSTMENT', 'REVERSAL', 'SYSTEM');
ALTER TABLE "ledger_entries" ALTER COLUMN "context_type" TYPE "LedgerSourceType_new" USING ("context_type"::text::"LedgerSourceType_new");
ALTER TYPE "LedgerSourceType" RENAME TO "LedgerSourceType_old";
ALTER TYPE "LedgerSourceType_new" RENAME TO "LedgerSourceType";
DROP TYPE "public"."LedgerSourceType_old";
COMMIT;

-- CreateTable
CREATE TABLE "system_wallets" (
    "id" TEXT NOT NULL,
    "type" "SystemWalletType" NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosca_circles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "admin_id" TEXT NOT NULL,
    "contribution_amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "frequency" "CycleFrequency" NOT NULL,
    "duration_cycles" INTEGER NOT NULL,
    "current_cycle" INTEGER NOT NULL DEFAULT 1,
    "max_slots" INTEGER NOT NULL,
    "filled_slots" INTEGER NOT NULL DEFAULT 0,
    "visibility" "CircleVisibility" NOT NULL DEFAULT 'PUBLIC',
    "payout_logic" "PayoutLogic" NOT NULL DEFAULT 'COMBINED',
    "status" "CircleStatus" NOT NULL DEFAULT 'DRAFT',
    "collateral_percentage" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
    "late_penalty_percent" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "pre_start_exit_penalty" BIGINT,
    "min_trust_score_required" INTEGER NOT NULL DEFAULT 0,
    "start_date" TIMESTAMP(3),
    "start_date_range_min" TIMESTAMP(3),
    "start_date_range_max" TIMESTAMP(3),
    "recruitment_deadline" TIMESTAMP(3),
    "auto_start_on_full" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rosca_circles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosca_memberships" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "payout_position" INTEGER,
    "collateral_amount" BIGINT NOT NULL,
    "collateral_released" BOOLEAN NOT NULL DEFAULT false,
    "completed_cycles" INTEGER NOT NULL DEFAULT 0,
    "total_late_payments" INTEGER NOT NULL DEFAULT 0,
    "total_penalties_paid" BIGINT NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rosca_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosca_cycle_schedules" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "contribution_deadline" TIMESTAMP(3) NOT NULL,
    "payout_date" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'UPCOMING',
    "recipient_id" TEXT,
    "obsoleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rosca_cycle_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosca_contributions" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "penalty_amount" BIGINT NOT NULL DEFAULT 0,
    "ledger_debit_id" TEXT,
    "transaction_reference" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rosca_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rosca_payouts" (
    "id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT DEFAULT 'FLUTTERWAVE',
    "provider_reference" TEXT,
    "internal_reference" TEXT,
    "pool_debit_id" TEXT,
    "recipient_credit_id" TEXT,
    "reversal_debit_id" TEXT,
    "reversal_credit_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rosca_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_trust_stats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trustScore" INTEGER NOT NULL DEFAULT 50,
    "completionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_roscas_joined" INTEGER NOT NULL DEFAULT 0,
    "total_roscas_completed" INTEGER NOT NULL DEFAULT 0,
    "total_on_time_payments" INTEGER NOT NULL DEFAULT 0,
    "total_late_payments" INTEGER NOT NULL DEFAULT 0,
    "total_defaults" INTEGER NOT NULL DEFAULT 0,
    "consecutive_late_payments" INTEGER NOT NULL DEFAULT 0,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_trust_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_bank_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "recipient_code" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_wallets_type_key" ON "system_wallets"("type");

-- CreateIndex
CREATE UNIQUE INDEX "system_wallets_wallet_id_key" ON "system_wallets"("wallet_id");

-- CreateIndex
CREATE UNIQUE INDEX "rosca_memberships_circle_id_user_id_key" ON "rosca_memberships"("circle_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "rosca_cycle_schedules_circle_id_cycle_number_obsoleted_at_key" ON "rosca_cycle_schedules"("circle_id", "cycle_number", "obsoleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "rosca_contributions_circle_id_membership_id_cycle_number_key" ON "rosca_contributions"("circle_id", "membership_id", "cycle_number");

-- CreateIndex
CREATE UNIQUE INDEX "rosca_payouts_schedule_id_key" ON "rosca_payouts"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_trust_stats_user_id_key" ON "user_trust_stats"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "saved_bank_accounts_user_id_account_number_bank_code_key" ON "saved_bank_accounts"("user_id", "account_number", "bank_code");

-- AddForeignKey
ALTER TABLE "system_wallets" ADD CONSTRAINT "system_wallets_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_circles" ADD CONSTRAINT "rosca_circles_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_memberships" ADD CONSTRAINT "rosca_memberships_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_memberships" ADD CONSTRAINT "rosca_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_cycle_schedules" ADD CONSTRAINT "rosca_cycle_schedules_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_cycle_schedules" ADD CONSTRAINT "rosca_cycle_schedules_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_contributions" ADD CONSTRAINT "rosca_contributions_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_contributions" ADD CONSTRAINT "rosca_contributions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "rosca_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_contributions" ADD CONSTRAINT "rosca_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_payouts" ADD CONSTRAINT "rosca_payouts_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_payouts" ADD CONSTRAINT "rosca_payouts_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "rosca_cycle_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rosca_payouts" ADD CONSTRAINT "rosca_payouts_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_trust_stats" ADD CONSTRAINT "user_trust_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_bank_accounts" ADD CONSTRAINT "saved_bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
