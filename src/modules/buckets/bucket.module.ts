import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { LedgerModule } from '../ledger/ledger.module';
import { BucketService } from './bucket.service';

@Module({
  imports: [
    PrismaModule,
    LedgerModule, // REQUIRED because you inject LedgerService
  ],
  providers: [BucketService],
  exports: [
    BucketService, // so Wallet / Rosca modules can use it
  ],
})
export class BucketModule {}
