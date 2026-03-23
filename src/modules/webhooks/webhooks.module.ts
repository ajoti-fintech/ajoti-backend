// src/modules/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '@/prisma';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { LedgerModule } from '../ledger/ledger.module'; // Was missing — required by WebhooksService

@Module({
  imports: [
    FlutterwaveModule, // FlutterwaveProvider — webhook verification + transaction verify
    LedgerModule,      // LedgerService — write CREDIT/REVERSAL entries
    PrismaModule,      // PrismaService — transaction records, webhook idempotency
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule { }