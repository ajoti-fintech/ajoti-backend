import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../../prisma';
import { VirtualAccountModule } from '../virtual-accounts/virtual-account.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [PrismaModule, VirtualAccountModule, WalletModule],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
