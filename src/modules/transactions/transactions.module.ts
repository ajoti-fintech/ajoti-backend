import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
