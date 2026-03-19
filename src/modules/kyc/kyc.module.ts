import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { UsersModule } from '../users/users.module';
import { IdentityVerificationService } from './identity-verification.service';
import { PrismaModule } from '@/prisma';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [KafkaModule, UsersModule, PrismaModule],
  controllers: [KycController],
  providers: [KycService, IdentityVerificationService],
  exports: [KycService, IdentityVerificationService],
})
export class KycModule {}
