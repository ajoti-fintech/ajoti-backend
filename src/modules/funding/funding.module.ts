import { Module } from '@nestjs/common';
import { FundingAdminController, FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import { WalletModule } from '../wallet/wallet.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { AuthModule } from '../auth/auth.module';
import { FundingReconciliationScheduler } from './funding-reconciliation.scheduler';

@Module({
  imports: [
    WalletModule,      // WalletService — validate wallet status
    LedgerModule,      // Available for ledger reads if needed
    TransactionsModule, // TransactionsService — create/update transaction records
    FlutterwaveModule, // FlutterwaveProvider — initiate payments
    AuthModule,        // JwtAuthGuard
  ],
  controllers: [FundingController, FundingAdminController],
  providers: [FundingService, FundingReconciliationScheduler],
  exports: [FundingService],
})
export class FundingModule {}
