// src/modules/contribution/contribution.module.ts
import { Module } from '@nestjs/common';
import { ContributionService } from './contribution.service';
import { ContributionController } from './contribution.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { TrustModule } from '../trust/trust.module';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [PrismaModule, LedgerModule, TrustModule],
  controllers: [ContributionController],
  providers: [ContributionService],
  exports: [ContributionService],
})
export class ContributionModule {}
