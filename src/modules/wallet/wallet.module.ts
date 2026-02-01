import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { WalletAdminController } from './wallet.controller'; // ← Add import
import { PrismaModule } from '../../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [
    WalletController,
    WalletAdminController,
    // WalletAdminController will be added here later
  ],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
