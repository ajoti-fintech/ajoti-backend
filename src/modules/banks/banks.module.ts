import { Module } from '@nestjs/common';
import { BanksController } from './banks.controller';
import { BanksService } from './banks.service';
import { FlutterwaveModule } from '../flutterwave/flutterwave.module';

@Module({
    imports: [FlutterwaveModule],
    controllers: [BanksController],
    providers: [BanksService],
})
export class BanksModule { }