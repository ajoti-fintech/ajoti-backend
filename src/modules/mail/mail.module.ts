import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { MailErrorMapper } from '@/common/error/mail-error';
import { BullModule } from '@nestjs/bullmq';
import { MailQueue, MAIL_QUEUE } from './mail.queue';
import { MailProcessor } from './mail.processor';
import { PrismaModule } from '@/prisma';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    BullModule.registerQueue({
      name: MAIL_QUEUE,
    }),
  ],
  providers: [
    MailService,
    MailErrorMapper,
    MailQueue,
    MailProcessor,
  ],
  controllers: [],
  exports: [
    MailService,
    MailErrorMapper,
    MailQueue,
  ],
})
export class MailModule {}