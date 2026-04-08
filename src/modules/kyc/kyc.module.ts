import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycProcessor } from './kyc.processor';
import { UsersModule } from '../users/users.module';
import { IdentityVerificationService } from './identity-verification.service';
import { PrismaModule } from '@/prisma';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';
import { VirtualAccountModule } from '../virtual-accounts/virtual-account.module';
import { PrismaModule } from '../../prisma';

@Module({
  imports: [
    BullModule.registerQueue({ name: AUTH_EVENTS_QUEUE }),
    UsersModule,
    PrismaModule,
    VirtualAccountModule,
  ],
  controllers: [KycController],
  providers: [KycService, IdentityVerificationService, KycProcessor],
  exports: [KycService, IdentityVerificationService],
})
export class KycModule {}
