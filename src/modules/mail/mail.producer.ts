import { Injectable } from '@nestjs/common';
import { KafkaService } from '../kafka/kafka.service';
import { randomUUID } from 'crypto';

@Injectable()
export class MailProducer {
  constructor(private readonly kafka: KafkaService) {}

  async enqueue(to: string, subject: string, html: string) {
    await this.kafka.emit('mail.send', {
      id: randomUUID(),
      to,
      subject,
      html,
      createdAt: new Date().toISOString(),
    });
  }
}
