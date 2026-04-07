import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';

export const MAIL_QUEUE = 'mail-queue';
export const MAIL_JOB_NAME = 'send-email';

@Injectable()
export class MailQueue {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue) {}

  async enqueue(to: string, subject: string, html: string) {
    const id = randomUUID();

    await this.mailQueue.add(
      MAIL_JOB_NAME,
      {
        id,
        to,
        subject,
        html,
        createdAt: new Date().toISOString(),
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
