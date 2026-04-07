import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import { MAIL_QUEUE, MAIL_JOB_NAME } from './mail.queue';
import { PrismaService } from '@/prisma';
import { MailJobStatus } from '@prisma/client';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mailService: MailService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name !== MAIL_JOB_NAME) return;

    const { id, to, subject, html } = job.data;

    // ── Outbox idempotency guard ────────────────────────────────────────────
    await this.prisma.mailOutbox.upsert({
      where: { id },
      create: { id, to, subject, html, status: MailJobStatus.PENDING },
      update: {}, // never overwrite an existing record
    });

    const record = await this.prisma.mailOutbox.findUnique({ where: { id } });
    if (record?.status === MailJobStatus.SENT) {
      this.logger.log(`[Job ${job.id}] Already sent — skipping (id=${id})`);
      return { sent: false, reason: 'duplicate' };
    }

    // ── Send ────────────────────────────────────────────────────────────────
    this.logger.log(`[Job ${job.id}] Sending email to ${to}`);

    try {
      await this.mailService.send(to, subject, html);

      await this.prisma.mailOutbox.update({
        where: { id },
        data: { status: MailJobStatus.SENT, sentAt: new Date() },
      });

      this.logger.log(`[Job ${job.id}] Email sent to ${to}`);
      return { sent: true, timestamp: new Date().toISOString() };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : '';

      await this.prisma.mailOutbox.update({
        where: { id },
        data: {
          status: MailJobStatus.FAILED,
          attempts: { increment: 1 },
          lastError: msg,
        },
      });

      this.logger.error(
        `[Job ${job.id}] Failed attempt ${job.attemptsMade + 1} for ${to}: ${msg}`,
        stack,
      );

      // Re-throw so BullMQ applies its exponential backoff (5s → 10s → 20s)
      throw error;
    }
  }
}
