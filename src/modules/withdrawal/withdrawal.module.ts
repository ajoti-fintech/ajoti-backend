import { Module } from '@nestjs/common';
import { WithdrawalController } from './withdrawal.controller';
import { WithdrawalService } from './withdrawal.service';
import { PrismaModule } from '@/prisma';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';

@Module({
    imports: [FlutterwaveModule, PrismaModule],
    controllers: [WithdrawalController],
    providers: [WithdrawalService],
    exports: [WithdrawalService],
})
export class WithdrawalModule {}