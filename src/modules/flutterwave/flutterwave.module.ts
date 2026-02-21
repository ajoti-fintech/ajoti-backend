import { Module } from '@nestjs/common';
import { FlutterwaveProvider } from './flutterwave.provider';

@Module({
    providers: [FlutterwaveProvider],
    exports: [FlutterwaveProvider],
})
export class FlutterwaveModule { }