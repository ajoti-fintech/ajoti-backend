import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { UsersModule } from '../users/users.module';
import { IdentityVerificationService } from './identity-verification.service';
import { PrismaModule } from '@/prisma';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';

@Module({
  imports: [
    BullModule.registerQueue({
      name: AUTH_EVENTS_QUEUE,
    }),
    UsersModule,
    PrismaModule,
  ],
  controllers: [KycController],
  providers: [KycService, IdentityVerificationService],
  exports: [KycService, IdentityVerificationService],
})
export class KycModule {}
