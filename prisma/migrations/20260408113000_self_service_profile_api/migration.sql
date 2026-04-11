ALTER TYPE "OTPPurpose" ADD VALUE IF NOT EXISTS 'EMAIL_CHANGE';

ALTER TABLE "User"
ADD COLUMN "pendingEmail" TEXT;

CREATE UNIQUE INDEX "User_pendingEmail_key" ON "User"("pendingEmail");
