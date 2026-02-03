/*
  Warnings:

  - You are about to drop the column `docBackUrl` on the `KYC` table. All the data in the column will be lost.
  - You are about to drop the column `docFrontUrl` on the `KYC` table. All the data in the column will be lost.
  - You are about to drop the column `docNumber` on the `KYC` table. All the data in the column will be lost.
  - You are about to drop the column `docType` on the `KYC` table. All the data in the column will be lost.
  - You are about to drop the column `selfieUrl` on the `KYC` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "KYCStep" AS ENUM ('NIN_REQUIRED', 'BVN_REQUIRED', 'NOK_REQUIRED', 'SUBMITTED');

-- AlterTable
ALTER TABLE "KYC" DROP COLUMN "docBackUrl",
DROP COLUMN "docFrontUrl",
DROP COLUMN "docNumber",
DROP COLUMN "docType",
DROP COLUMN "selfieUrl",
ADD COLUMN     "bvn" TEXT,
ADD COLUMN     "bvnVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "nextOfKinName" TEXT,
ADD COLUMN     "nextOfKinRelationship" TEXT,
ADD COLUMN     "nin" TEXT,
ADD COLUMN     "ninVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "step" "KYCStep" NOT NULL DEFAULT 'NIN_REQUIRED';
