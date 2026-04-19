/*
  Warnings:

  - You are about to drop the `sim_ledger_entries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `sim_wallet_buckets` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "sim_ledger_entries" DROP CONSTRAINT "sim_ledger_entries_wallet_id_fkey";

-- DropForeignKey
ALTER TABLE "sim_wallet_buckets" DROP CONSTRAINT "sim_wallet_buckets_wallet_id_fkey";

-- DropTable
DROP TABLE "sim_ledger_entries";

-- DropTable
DROP TABLE "sim_wallet_buckets";
