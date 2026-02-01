import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TransactionsService } from './transactions.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { FlutterwaveService } from './flutterwave.service';

@Module({
  imports: [
    PrismaModule,
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5,
    }),
  ],
  providers: [TransactionsService, FlutterwaveService],
  exports: [TransactionsService, FlutterwaveService],
})
export class TransactionsModule {}
