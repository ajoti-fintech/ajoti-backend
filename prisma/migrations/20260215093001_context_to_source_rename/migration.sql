/*
  Warnings:

  - You are about to drop the column `context_id` on the `ledger_entries` table. All the data in the column will be lost.
  - You are about to drop the column `context_type` on the `ledger_entries` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[wallet_id,reference,source_type,source_id]` on the table `ledger_entries` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `source_id` to the `ledger_entries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `source_type` to the `ledger_entries` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ledger_entries_wallet_id_context_type_context_id_idx";

-- DropIndex
DROP INDEX "ledger_entries_wallet_id_reference_context_type_context_id_key";

-- AlterTable
ALTER TABLE "ledger_entries" DROP COLUMN "context_id",
DROP COLUMN "context_type",
ADD COLUMN     "source_id" TEXT NOT NULL,
ADD COLUMN     "source_type" "LedgerSourceType" NOT NULL;

-- CreateIndex
CREATE INDEX "ledger_entries_wallet_id_source_type_source_id_idx" ON "ledger_entries"("wallet_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_wallet_id_reference_source_type_source_id_key" ON "ledger_entries"("wallet_id", "reference", "source_type", "source_id");
