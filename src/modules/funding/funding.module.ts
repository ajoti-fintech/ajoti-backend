import { Module } from '@nestjs/common';
import { FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import { WalletModule } from '../wallet/wallet.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    WalletModule, // To get user wallet
    LedgerModule, // To write ledger entries
    TransactionsModule, // To create/update transactions and call Flutterwave
    AuthModule, // For guards
  ],
  controllers: [FundingController],
  providers: [FundingService],
  exports: [FundingService], // For webhooks module
})
export class FundingModule {}
