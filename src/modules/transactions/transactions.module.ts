// src/modules/transaction/transaction.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TransactionsService } from './transactions.service';
import { FlutterwaveService } from './flutterwave.service';
import { LedgerModule } from '../ledger/ledger.module';
import { PrismaModule } from '@/prisma';

@Module({
  imports: [HttpModule, LedgerModule, PrismaModule],
  providers: [TransactionsService, FlutterwaveService],
  exports: [TransactionsService, FlutterwaveService],
})
export class TransactionsModule {}
