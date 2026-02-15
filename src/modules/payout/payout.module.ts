import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutService } from './payout.service';
import { PayoutSchedulerService } from './payout-scheduler.service';
import { PrismaModule } from '@/prisma';
import { LedgerModule } from '../ledger/ledger.module';
import { PayoutAdminController, PayoutController } from './payout.controller';

@Module({
  imports: [PrismaModule, LedgerModule, ScheduleModule],
  controllers: [PayoutController, PayoutAdminController], // Add both here
  providers: [PayoutService, PayoutSchedulerService],
  exports: [PayoutService],
})
export class PayoutModule {}
