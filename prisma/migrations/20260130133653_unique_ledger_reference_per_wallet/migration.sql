/*
  Warnings:

  - A unique constraint covering the columns `[wallet_id,reference]` on the table `ledger_entries` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ledger_entries_reference_key";

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "context_id" TEXT,
ADD COLUMN     "context_type" TEXT;

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_context_type_context_id_idx" ON "ledger_entries"("wallet_id", "context_type", "context_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_wallet_id_reference_key" ON "ledger_entries"("wallet_id", "reference");
