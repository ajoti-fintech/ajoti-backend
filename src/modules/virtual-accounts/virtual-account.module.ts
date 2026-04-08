import { Module } from '@nestjs/common';
import { VirtualAccountService } from './virtual-account.service';
import { VirtualAccountController } from './virtual-account.controller';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';
import { PrismaModule } from '../../prisma';
import { WalletModule } from '../wallet/wallet.module';

@Module({
    imports: [FlutterwaveModule, PrismaModule, WalletModule],
    controllers: [VirtualAccountController],
    providers: [VirtualAccountService],
    exports: [VirtualAccountService], // Exported so WebhooksModule can look up VAs
})
export class VirtualAccountModule { }
