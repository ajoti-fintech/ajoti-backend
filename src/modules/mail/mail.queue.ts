import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const MAIL_QUEUE = 'mail-queue';

@Injectable()
export class MailQueue {
  constructor(
    @InjectQueue(MAIL_QUEUE) private readonly mailQueue: Queue,
  ) {}

  async enqueue(to: string, subject: string, html: string) {
    await this.mailQueue.add(
      'send-email',
      {
        to,
        subject,
        html,
        createdAt: new Date().toISOString(),
      },
      {
        attempts: 3,                    // retry 3 times
        backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s...
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    console.log(`[MailQueue] Email job added to queue for ${to}`);
  }
}