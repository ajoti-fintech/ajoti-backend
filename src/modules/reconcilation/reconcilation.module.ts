import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconcilation.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService], // Exported so the WalletModule or Admin controllers can use it
})
export class ReconciliationModule {}
