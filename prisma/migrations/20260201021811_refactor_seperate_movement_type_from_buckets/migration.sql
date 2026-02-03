/*
  Warnings:

  - You are about to drop the column `category` on the `ledger_entries` table. All the data in the column will be lost.
  - Added the required column `movement_type` to the `ledger_entries` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('FUNDING', 'WITHDRAWAL', 'INTERNAL');

-- AlterEnum
ALTER TYPE "BucketType" ADD VALUE 'MAIN';

-- AlterTable
ALTER TABLE "ledger_entries" DROP COLUMN "category",
ADD COLUMN     "bucket_type" "BucketType",
ADD COLUMN     "movement_type" "MovementType" NOT NULL;

-- DropEnum
DROP TYPE "Category";
