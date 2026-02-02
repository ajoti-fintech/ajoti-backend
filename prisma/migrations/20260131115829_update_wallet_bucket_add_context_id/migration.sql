/*
  Warnings:

  - You are about to drop the `wallet_balances` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[wallet_id,bucket_type,context_id]` on the table `wallet_buckets` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "wallet_balances" DROP CONSTRAINT "wallet_balances_walletId_fkey";

-- DropIndex
DROP INDEX "ledger_entries_created_at_idx";

-- DropIndex
DROP INDEX "ledger_entries_reference_idx";

-- DropIndex
DROP INDEX "ledger_entries_wallet_id_idx";

-- DropIndex
DROP INDEX "wallet_buckets_wallet_id_bucket_type_key";

-- AlterTable
ALTER TABLE "wallet_buckets" ADD COLUMN     "context_id" TEXT;

-- DropTable
DROP TABLE "wallet_balances";

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_created_at_idx" ON "ledger_entries"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_buckets_wallet_id_bucket_type_context_id_key" ON "wallet_buckets"("wallet_id", "bucket_type", "context_id");
