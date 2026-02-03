/*
  Warnings:

  - You are about to drop the column `raw_payload` on the `transactions` table. All the data in the column will be lost.
  - Added the required column `transaction_type` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('FUNDING', 'WITHDRAWAL');

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "raw_payload",
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "transaction_type" "TransactionType" NOT NULL;

-- CreateIndex
CREATE INDEX "transactions_transaction_type_idx" ON "transactions"("transaction_type");
