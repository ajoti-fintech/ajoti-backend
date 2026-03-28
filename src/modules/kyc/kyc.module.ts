import { Module } from '@nestjs/common';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { UsersModule } from '../users/users.module';
import { IdentityVerificationService } from './identity-verification.service';
import { PrismaModule } from '@/prisma';
import { VirtualAccountModule } from '../virtual-accounts/virtual-account.module';

@Module({
  imports: [UsersModule, PrismaModule, VirtualAccountModule],
  controllers: [KycController],
  providers: [KycService, IdentityVerificationService],
  exports: [KycService, IdentityVerificationService],
})
export class KycModule {}
