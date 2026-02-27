import { Module } from '@nestjs/common';
import { OtpService } from './otp.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '@/prisma';
import { MailErrorMapper } from '@/common/error/mail-error';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [ConfigModule, MailModule],
  providers: [PrismaService, MailErrorMapper, OtpService],
  exports: [OtpService],
})
export class OtpModule {}
