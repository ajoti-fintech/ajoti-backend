import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../prisma';
import { VirtualAccountModule } from '../virtual-accounts/virtual-account.module';
import { WalletModule } from '../wallet/wallet.module';
import { OtpModule } from '../otp/otp.module';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';

@Module({
  imports: [
    PrismaModule,
    VirtualAccountModule,
    WalletModule,
    OtpModule,
    BullModule.registerQueue({ name: AUTH_EVENTS_QUEUE }),
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
