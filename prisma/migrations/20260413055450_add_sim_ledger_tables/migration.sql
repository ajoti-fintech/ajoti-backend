-- CreateTable
CREATE TABLE "sim_ledger_entries" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "entry_type" "EntryType" NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "bucket_type" "BucketType",
    "amount" BIGINT NOT NULL,
    "balance_before" BIGINT NOT NULL,
    "balance_after" BIGINT NOT NULL,
    "metadata" JSONB,
    "source_type" "LedgerSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_wallet_buckets" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "bucket_type" "BucketType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "reserved_amount" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sim_wallet_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sim_ledger_entries_wallet_id_created_at_idx" ON "sim_ledger_entries"("wallet_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sim_ledger_entries_wallet_id_reference_source_type_source_i_key" ON "sim_ledger_entries"("wallet_id", "reference", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "sim_wallet_buckets_wallet_id_bucket_type_source_id_key" ON "sim_wallet_buckets"("wallet_id", "bucket_type", "source_id");

-- AddForeignKey
ALTER TABLE "sim_ledger_entries" ADD CONSTRAINT "sim_ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_wallet_buckets" ADD CONSTRAINT "sim_wallet_buckets_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
