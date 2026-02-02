import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { MailErrorMapper } from '@/common/error/mail-error';

@Module({
  imports: [ConfigModule],
  providers: [MailService, MailErrorMapper],
  exports: [MailService, MailErrorMapper],
})
export class MailModule {}
