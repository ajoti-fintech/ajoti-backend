/*
  Warnings:

  - The values [INTERNAL] on the enum `MovementType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `context_id` on the `wallet_buckets` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[wallet_id,reference,context_type,context_id]` on the table `ledger_entries` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[wallet_id,bucket_type,source_id]` on the table `wallet_buckets` will be added. If there are existing duplicate values, this will fail.
  - Made the column `context_id` on table `ledger_entries` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `context_type` to the `ledger_entries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `source_id` to the `wallet_buckets` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LedgerSourceType" AS ENUM ('TRANSACTION', 'ROSCA_CIRCLE', 'TARGET_SAVINGS', 'FIXED_SAVINGS', 'ADMIN_ADJUSTMENT', 'SYSTEM');

-- AlterEnum
BEGIN;
CREATE TYPE "MovementType_new" AS ENUM ('FUNDING', 'WITHDRAWAL', 'TRANSFER');
ALTER TABLE "ledger_entries" ALTER COLUMN "movement_type" TYPE "MovementType_new" USING ("movement_type"::text::"MovementType_new");
ALTER TYPE "MovementType" RENAME TO "MovementType_old";
ALTER TYPE "MovementType_new" RENAME TO "MovementType";
DROP TYPE "MovementType_old";
COMMIT;

-- DropIndex
DROP INDEX "ledger_entries_wallet_id_reference_key";

-- DropIndex
DROP INDEX "wallet_buckets_wallet_id_bucket_type_context_id_key";

-- AlterTable
ALTER TABLE "ledger_entries" ALTER COLUMN "context_id" SET NOT NULL,
DROP COLUMN "context_type",
ADD COLUMN     "context_type" "LedgerSourceType" NOT NULL;

-- AlterTable
ALTER TABLE "wallet_buckets" DROP COLUMN "context_id",
ADD COLUMN     "source_id" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_context_type_context_id_idx" ON "ledger_entries"("wallet_id", "context_type", "context_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_wallet_id_reference_context_type_context_id_key" ON "ledger_entries"("wallet_id", "reference", "context_type", "context_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_buckets_wallet_id_bucket_type_source_id_key" ON "wallet_buckets"("wallet_id", "bucket_type", "source_id");
