-- Add UserStatus enum and status/suspension fields to User table
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

ALTER TABLE "User"
  ADD COLUMN "status"            "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "suspended_at"      TIMESTAMP(3),
  ADD COLUMN "suspension_reason" TEXT;

CREATE INDEX "User_status_idx" ON "User"("status");
