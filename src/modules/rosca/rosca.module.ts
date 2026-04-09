// src/modules/rosca/rosca.module.ts
import { Module } from '@nestjs/common';
import { RoscaService } from './rosca.service';
import {
  RoscaAdminController,
  RoscaController,
  RoscaSuperAdminController,
} from './rosca.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerModule } from '../ledger/ledger.module'; // import if LedgerService is in another module
import { PrismaModule } from '@/prisma';
import { AuthModule } from '../auth/auth.module';
import { PayoutModule } from '../payout/payout.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [LedgerModule, PrismaModule, AuthModule, PayoutModule, NotificationModule],
  controllers: [RoscaController, RoscaAdminController, RoscaSuperAdminController],
  providers: [RoscaService, PrismaService],
  exports: [RoscaService], // if other modules need to use it
})
export class RoscaModule {}
