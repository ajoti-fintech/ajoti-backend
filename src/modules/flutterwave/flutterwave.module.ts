import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FlutterwaveProvider } from './flutterwave.provider';

@Module({
  imports: [ConfigModule], // Needed for ConfigService in FlutterwaveProvider
  providers: [FlutterwaveProvider],
  exports: [FlutterwaveProvider],
})
export class FlutterwaveModule { }