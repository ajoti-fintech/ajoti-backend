-- DropForeignKey
ALTER TABLE "wallet_balances" DROP CONSTRAINT "wallet_balances_walletId_fkey";

-- AddForeignKey
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
