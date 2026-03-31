import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import { MAIL_QUEUE } from './mail.queue';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly mailService: MailService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { to, subject, html } = job.data;

    this.logger.log(`[Job ${job.id}] Processing email for: ${to}`);

    try {
      await this.mailService.send(to, subject, html);
      this.logger.log(`[Job ${job.id}] Email successfully sent to ${to}`);
      return { sent: true, timestamp: new Date().toISOString() };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown mailing error';
      const errorStack = error instanceof Error ? error.stack : '';

      this.logger.error(
        `[Job ${job.id}] Failed attempt ${job.attemptsMade + 1} for ${to}: ${errorMessage}`,
        errorStack,
      );

      // Re-throwing allows BullMQ to handle the exponential backoff (5s, 10s, 20s...)
      throw error;
    }
  }
}