-- Add method-specific funding transaction types for settled checkout payments.
-- Keep FUNDING for initiated/pending transactions where the customer method
-- is still unknown at initialization time.
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'FUNDING_CARD';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'FUNDING_USSD';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'FUNDING_BANKTRANSFER';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'FUNDING_ACCOUNT';
