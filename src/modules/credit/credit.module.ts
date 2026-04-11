import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma';
import { TrustModule } from '../trust/trust.module';
import { CreditService } from './credit.service';
import { CreditController } from './credit.controller';
import { ExternalCreditService } from './external-credit.service';

@Module({
  imports: [PrismaModule, TrustModule],
  providers: [CreditService, ExternalCreditService],
  controllers: [CreditController],
  exports: [CreditService],
})
export class CreditModule {}
