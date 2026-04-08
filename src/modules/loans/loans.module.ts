import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma';
import { LedgerModule } from '../ledger/ledger.module';
import { CreditModule } from '../credit/credit.module';
import { LoanService } from './loans.service';
import { LoanController } from './loans.controller';

@Module({
  imports: [PrismaModule, LedgerModule, CreditModule],
  providers: [LoanService],
  controllers: [LoanController],
  exports: [LoanService],
})
export class LoanModule {}
