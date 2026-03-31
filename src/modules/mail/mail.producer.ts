import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class MailProducer {
  constructor() {}

  async enqueue(to: string, subject: string, html: string) {
    console.warn(`[MailProducer] Email enqueued - BullMQ not yet connected:`, {
      to,
      subject,
      htmlLength: html?.length || 0,
      timestamp: new Date().toISOString(),
    });

    // TODO: Replace this with BullMQ job when we finish Step 1
    // For now we just log so the app can start
  }
}