-- Patch: add initial_contribution_deadline column to rosca_circles
-- Safe to run on any environment — guarded with IF NOT EXISTS.
-- This column was part of migration 20260408193808 which failed on Neon
-- due to pre-existing enum types. The rest of that migration's content
-- already existed on Neon via db push.

ALTER TABLE "rosca_circles"
  ADD COLUMN IF NOT EXISTS "initial_contribution_deadline" TIMESTAMP(3);
