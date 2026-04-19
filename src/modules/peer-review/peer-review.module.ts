// src/modules/peer-review/peer-review.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { TrustModule } from '../trust/trust.module';
import { AuthModule } from '../auth/auth.module';
import { PeerReviewController } from './peer-review.controller';
import { PeerReviewService } from './peer-review.service';

@Module({
  imports: [PrismaModule, TrustModule, AuthModule],
  controllers: [PeerReviewController],
  providers: [PeerReviewService],
  exports: [PeerReviewService],
})
export class PeerReviewModule {}
