// src/modules/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '../../prisma';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';
// VirtualAccountModule is imported so WebhooksService can query
// the virtual_accounts table when routing VA charge.completed events.
// Note: We only need Prisma access (via PrismaModule) — we do NOT need
// VirtualAccountService here. PrismaModule already gives us direct DB access.
// VirtualAccountModule is listed here for documentation clarity only.
// If VirtualAccountService were needed, we would import VirtualAccountModule
// and add it to imports[].

@Module({
  imports: [
    FlutterwaveModule,                              // FlutterwaveProvider — webhook verification + tx verification
    PrismaModule,                                   // PrismaService — direct DB queries (ledger, webhook_events, virtual_accounts)
    BullModule.registerQueue({ name: AUTH_EVENTS_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule { }