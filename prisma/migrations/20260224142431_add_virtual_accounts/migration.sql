-- CreateTable
CREATE TABLE "virtual_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "flw_ref" TEXT NOT NULL,
    "order_ref" TEXT NOT NULL,
    "tx_ref" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_permanent" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_user_id_key" ON "virtual_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_wallet_id_key" ON "virtual_accounts"("wallet_id");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_flw_ref_key" ON "virtual_accounts"("flw_ref");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_order_ref_key" ON "virtual_accounts"("order_ref");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_tx_ref_key" ON "virtual_accounts"("tx_ref");

-- AddForeignKey
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
