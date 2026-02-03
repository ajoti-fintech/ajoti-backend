import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { WalletAdminController } from './wallet.controller'; // ← Add import
import { PrismaModule } from '../../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [PrismaModule, LedgerModule],
  controllers: [
    WalletController,
    WalletAdminController,
    // WalletAdminController will be added here later
  ],
  providers: [WalletService, RolesGuard],
  exports: [WalletService],
})
export class WalletModule {}
