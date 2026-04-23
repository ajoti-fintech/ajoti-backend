// src/modules/trust/trust.module.ts
import { Module } from '@nestjs/common';
import { TrustService } from './trust.service';
import { TrustController } from './trust.controller';
import { TrustAdminController } from './trust-admin.controller';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TrustService],
  controllers: [TrustController, TrustAdminController],
  exports: [TrustService], // Required by Contribution and Rosca modules
})
export class TrustModule {}
