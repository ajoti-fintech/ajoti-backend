import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerModule } from '../../ledger/ledger.module';
import { BucketService } from './bucket.service';

@Module({
  imports: [
    LedgerModule, // REQUIRED because you inject LedgerService
  ],
  providers: [BucketService, PrismaService],
  exports: [
    BucketService, // so Wallet / Rosca modules can use it
  ],
})
export class BucketModule {}
