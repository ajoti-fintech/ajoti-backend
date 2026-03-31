import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { ConfigModule } from '@nestjs/config';
import { MailErrorMapper } from '@/common/error/mail-error';
import { BullModule } from '@nestjs/bullmq';
import { MailQueue, MAIL_QUEUE } from './mail.queue';
import { MailProcessor } from './mail.processor';
// import { MailProducer } from './mail.producer'; // Obsolete - replaced by MailQueue
// import { MailConsumer } from './mail.consumer'; // Obsolete - replaced by MailProcessor

@Module({
  imports: [
    ConfigModule,
    // Registers the BullMQ queue for this module
    BullModule.registerQueue({
      name: MAIL_QUEUE,
    }),
  ],
  providers: [
    MailService, 
    MailErrorMapper, 
    MailQueue,     // New BullMQ Producer
    MailProcessor  // New BullMQ Worker
    // MailProducer, 
  ],
  controllers: [
    // MailConsumer // No longer needed as we use the Processor worker
  ],
  exports: [
    MailService, 
    MailErrorMapper, 
    MailQueue      // Export this so Auth/OTP can inject it
  ],
})
export class MailModule {}