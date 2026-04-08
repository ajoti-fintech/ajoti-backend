-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'REPAID', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GovernmentIdType" AS ENUM ('NIN_SLIP', 'PASSPORT', 'DRIVERS_LICENSE', 'PVC_CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ProofOfAddressType" AS ENUM ('UTILITY_BILL', 'BANK_STATEMENT', 'TENANCY_AGREEMENT', 'GOVERNMENT_ADDRESS_DOCUMENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "MailJobStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KYCStep" ADD VALUE 'ADDRESS_REQUIRED';
ALTER TYPE "KYCStep" ADD VALUE 'PHOTO_REQUIRED';
ALTER TYPE "KYCStep" ADD VALUE 'PROOF_OF_ADDRESS_REQUIRED';

-- AlterEnum
ALTER TYPE "LedgerSourceType" ADD VALUE 'LOAN';

-- AlterEnum
ALTER TYPE "OTPPurpose" ADD VALUE 'KYC_VERIFICATION';

-- AlterTable
ALTER TABLE "kyc" ADD COLUMN     "address" VARCHAR(255),
ADD COLUMN     "city" VARCHAR(100),
ADD COLUMN     "country" VARCHAR(100),
ADD COLUMN     "governmentIdBackUrl" TEXT,
ADD COLUMN     "governmentIdFrontUrl" TEXT,
ADD COLUMN     "governmentIdType" "GovernmentIdType",
ADD COLUMN     "governmentIdUploadedAt" TIMESTAMP(3),
ADD COLUMN     "lga" VARCHAR(100),
ADD COLUMN     "proofOfAddressType" "ProofOfAddressType",
ADD COLUMN     "proofOfAddressUploadedAt" TIMESTAMP(3),
ADD COLUMN     "proofOfAddressUrl" TEXT,
ADD COLUMN     "proofOfAddressVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "selfieUploadedAt" TIMESTAMP(3),
ADD COLUMN     "selfieUrl" TEXT,
ADD COLUMN     "state" VARCHAR(100);

-- AlterTable
ALTER TABLE "user_trust_stats" ADD COLUMN     "average_peer_rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "expected_payments_last_cycle" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "expected_post_payout_payments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "on_time_payments_last_cycle" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "post_payout_on_time_payments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_expected_payments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_missed_payments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_peer_ratings" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "credit_scores" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "external_score" INTEGER NOT NULL DEFAULT 575,
    "trust_display_score" INTEGER NOT NULL DEFAULT 575,
    "final_score" INTEGER NOT NULL DEFAULT 575,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "circle_id" TEXT NOT NULL,
    "payout_amount" BIGINT NOT NULL,
    "loan_amount" BIGINT NOT NULL,
    "company_fee" BIGINT NOT NULL,
    "final_payout" BIGINT NOT NULL,
    "credit_score_used" INTEGER NOT NULL,
    "allowed_percent" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repaid_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOutbox" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "status" "MailJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_scores_user_id_key" ON "credit_scores"("user_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_isRead_idx" ON "Notification"("user_id", "isRead");

-- CreateIndex
CREATE INDEX "Notification_user_id_createdAt_idx" ON "Notification"("user_id", "createdAt");

-- CreateIndex
CREATE INDEX "MailOutbox_status_attempts_idx" ON "MailOutbox"("status", "attempts");

-- AddForeignKey
ALTER TABLE "credit_scores" ADD CONSTRAINT "credit_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "rosca_circles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
