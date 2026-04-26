// src/modules/rosca/rosca.module.ts
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { PrismaModule } from '@/prisma';
import { AuthModule } from '../auth/auth.module';
import { PayoutModule } from '../payout/payout.module';
import { NotificationModule } from '../notification/notification.module';
import { MailModule } from '../mail/mail.module';

import { CircleService } from './services/circle.service';
import { MembershipService } from './services/membership.service';
import { AdminOversightService } from './services/admin-oversight.service';
import { InviteService } from './services/invite.service';

import { RoscaController } from './controllers/rosca.controller';
import { RoscaAdminController } from './controllers/rosca-admin.controller';
import { RoscaSuperAdminController } from './controllers/rosca-superadmin.controller';

@Module({
  imports: [LedgerModule, PrismaModule, AuthModule, PayoutModule, NotificationModule, MailModule],
  controllers: [RoscaController, RoscaAdminController, RoscaSuperAdminController],
  providers: [CircleService, MembershipService, AdminOversightService, InviteService],
  exports: [CircleService, MembershipService, AdminOversightService, InviteService],
})
export class RoscaModule {}
