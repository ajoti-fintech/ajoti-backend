-- DropIndex
DROP INDEX "User_status_idx";

-- AlterTable
ALTER TABLE "kyc" ALTER COLUMN "nin" SET DATA TYPE TEXT,
ALTER COLUMN "bvn" SET DATA TYPE TEXT;
