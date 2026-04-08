// src/modules/rosca/rosca.module.ts
import { Module } from '@nestjs/common';
import { RoscaService } from './rosca.service';
import { RoscaAdminController, RoscaController } from './rosca.controller';
import { LedgerModule } from '../ledger/ledger.module'; // import if LedgerService is in another module
import { PrismaModule } from '../../prisma';
import { AuthModule } from '../auth/auth.module';
import { PayoutModule } from '../payout/payout.module';

@Module({
  imports: [LedgerModule, PrismaModule, AuthModule, PayoutModule], // if LedgerService is exported from there
  controllers: [RoscaController, RoscaAdminController],
  providers: [RoscaService],
  exports: [RoscaService], // if other modules need to use it
})
export class RoscaModule { }
