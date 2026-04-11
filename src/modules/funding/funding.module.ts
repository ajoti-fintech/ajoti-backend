import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FundingAdminController, FundingController } from './funding.controller';
import { FundingService } from './funding.service';
import { WalletModule } from '../wallet/wallet.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { AuthModule } from '../auth/auth.module';
import { FundingReconciliationProcessor } from './funding-reconciliation.processor';
import { FundingReconciliationScheduler } from './funding-reconciliation.scheduler';
import { FUNDING_RECONCILIATION_QUEUE } from './funding.queue';

@Module({
  imports: [
    BullModule.registerQueue({
      name: FUNDING_RECONCILIATION_QUEUE,
    }),
    WalletModule,      // WalletService — validate wallet status
    LedgerModule,      // Available for ledger reads if needed
    TransactionsModule, // TransactionsService — create/update transaction records
    FlutterwaveModule, // FlutterwaveProvider — initiate payments
    AuthModule,        // JwtAuthGuard
  ],
  controllers: [FundingController, FundingAdminController],
  providers: [
    FundingService,
    FundingReconciliationScheduler,
    FundingReconciliationProcessor,
  ],
  exports: [FundingService],
})
export class FundingModule {}
