import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@/prisma';
import { MailService } from './mail.service';
import { MailJobStatus } from '@prisma/client';

@Injectable()
export class MailRetryService {
  private logger = new Logger(MailRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Cron('*/30 * * * * *') // every 30 seconds
  async retry() {
    const maxAttempts = 5;

    const jobs = await this.prisma.mailOutbox.findMany({
      where: { status: MailJobStatus.FAILED, attempts: { lt: maxAttempts } },
      orderBy: { updatedAt: 'asc' },
      take: 10,
    });

    for (const job of jobs) {
      // simple backoff: wait 2^attempts minutes before retry
      const waitMs = Math.min(2 ** job.attempts * 60_000, 30 * 60_000);
      const nextAt = new Date(job.updatedAt.getTime() + waitMs);
      if (new Date() < nextAt) continue;

      try {
        await this.mail.send(job.to, job.subject, job.html);
        await this.prisma.mailOutbox.update({
          where: { id: job.id },
          data: { status: MailJobStatus.SENT, sentAt: new Date() },
        });
        this.logger.log(`Retry success: ${job.to}`);
      } catch (err: any) {
        await this.prisma.mailOutbox.update({
          where: { id: job.id },
          data: {
            attempts: { increment: 1 },
            lastError: err?.message || 'retry failed',
            status: MailJobStatus.FAILED,
          },
        });
        this.logger.error(`Retry failed: ${job.to}`, err?.stack || err);
      }
    }
  }
}
