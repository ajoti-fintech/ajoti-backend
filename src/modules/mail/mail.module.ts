import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { MailErrorMapper } from '@/common/error/mail-error';
import { MailProducer } from './mail.producer';
import { KafkaModule } from '../kafka/kafka.module';
import { MailConsumer } from './mail.consumer';

@Module({
  imports: [ConfigModule, KafkaModule],
  providers: [MailService, MailErrorMapper, MailProducer],
  controllers: [MailConsumer],
  exports: [MailService, MailErrorMapper, MailProducer],
})
export class MailModule {}
