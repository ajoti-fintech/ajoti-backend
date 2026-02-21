// src/modules/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '@/prisma';
import { TransactionsModule } from '../transactions/transactions.module'; // ← Added for provider verification
import { LedgerModule } from '../ledger/ledger.module';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';

@Module({
  imports: [
    FlutterwaveModule,
    PrismaModule,
    TransactionsModule
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  // exports: [WebhooksService], // Uncomment only if another module needs to trigger webhook logic
})
export class WebhooksModule {}
