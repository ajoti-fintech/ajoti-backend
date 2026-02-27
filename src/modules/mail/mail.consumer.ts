import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { PrismaService } from '@/prisma';
import { MailService } from './mail.service';
import { MailJobStatus } from '@prisma/client';

@Controller()
export class MailConsumer {
  private readonly logger = new Logger(MailConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @EventPattern('mail.send')
  async handle(@Payload() payload: any) {
    const { id, to, subject, html } = payload ?? {};
    if (!id || !to || !subject || !html) return;

    // idempotency: create once
    await this.prisma.mailOutbox.upsert({
      where: { id },
      create: { id, to, subject, html, status: MailJobStatus.PENDING },
      update: {}, // keep existing
    });

    // if already sent, do nothing
    const existing = await this.prisma.mailOutbox.findUnique({ where: { id } });
    if (existing?.status === MailJobStatus.SENT) return;

    try {
      await this.mail.send(to, subject, html);

      await this.prisma.mailOutbox.update({
        where: { id },
        data: { status: MailJobStatus.SENT, sentAt: new Date() },
      });

      this.logger.log(`Mail sent to ${to}`);
    } catch (err: any) {
      const msg = err?.message || 'mail send failed';

      await this.prisma.mailOutbox.update({
        where: { id },
        data: {
          status: MailJobStatus.FAILED,
          attempts: { increment: 1 },
          lastError: msg,
        },
      });

      this.logger.error(`Mail failed for ${to}: ${msg}`);
      // DO NOT throw. We will retry via cron/backoff.
      return;
    }
  }
}
