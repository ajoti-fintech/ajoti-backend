/*
  Warnings:

  - You are about to drop the `KYC` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "KYC" DROP CONSTRAINT "KYC_userId_fkey";

-- DropTable
DROP TABLE "KYC";

-- CreateTable
CREATE TABLE "kyc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "KYCStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "step" "KYCStep" NOT NULL DEFAULT 'NIN_REQUIRED',
    "nin" VARCHAR(11),
    "bvn" VARCHAR(11),
    "ninVerifiedAt" TIMESTAMP(3),
    "bvnVerifiedAt" TIMESTAMP(3),
    "nextOfKinName" VARCHAR(255),
    "nextOfKinRelationship" VARCHAR(255),
    "nextOfKinPhone" VARCHAR(20),
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kyc_userId_key" ON "kyc"("userId");

-- CreateIndex
CREATE INDEX "kyc_status_idx" ON "kyc"("status");

-- CreateIndex
CREATE INDEX "kyc_step_idx" ON "kyc"("step");

-- CreateIndex
CREATE INDEX "kyc_userId_status_idx" ON "kyc"("userId", "status");

-- AddForeignKey
ALTER TABLE "kyc" ADD CONSTRAINT "kyc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
