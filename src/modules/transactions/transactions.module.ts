// src/modules/transactions/transactions.module.ts
//
// FlutterwaveService has been removed from this module.
// The canonical FlutterwaveProvider lives in FlutterwaveModule.
// Any module that needs to call Flutterwave directly should import FlutterwaveModule.
//
// This module retains TransactionsService for:
//   - Creating PENDING transaction records
//   - Atomic settlement (webhook success path)
//   - Marking transactions FAILED
//   - Reference lookups
import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { LedgerModule } from '../ledger/ledger.module';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [LedgerModule, PrismaModule],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule { }