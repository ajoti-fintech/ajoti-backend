import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutService } from './payout.service';
import { PayoutSchedulerService } from './payout-scheduler.service';
import { PrismaModule } from '@/prisma';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutAdminController, PayoutController } from './payout.controller';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';
import { LoanModule } from '../loans/loans.module';
import { TrustModule } from '../trust/trust.module';
import { CreditModule } from '../credit/credit.module';

@Module({
  imports: [PrismaModule, LedgerModule, ScheduleModule, LoanModule, TrustModule, CreditModule, BullModule.registerQueue({ name: AUTH_EVENTS_QUEUE })],
  controllers: [PayoutController, PayoutAdminController],
  providers: [PayoutService, PayoutSchedulerService],
  exports: [PayoutService],
})
export class PayoutModule {}
