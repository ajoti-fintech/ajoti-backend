-- AlterEnum
ALTER TYPE "OTPPurpose" ADD VALUE 'KYC_VERIFICATION';

-- DropIndex
DROP INDEX "MailOutbox_status_idx";

-- CreateIndex
CREATE INDEX "MailOutbox_status_attempts_idx" ON "MailOutbox"("status", "attempts");
