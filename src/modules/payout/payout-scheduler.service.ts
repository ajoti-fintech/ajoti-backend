import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from './payout.service';
import { PrismaService } from '../../prisma';
import { PayoutStatus, ScheduleStatus } from '@prisma/client';

@Injectable()
export class PayoutSchedulerService {
  private readonly logger = new Logger(PayoutSchedulerService.name);

  constructor(
    private readonly payoutService: PayoutService,
    private readonly prisma: PrismaService,
  ) { }

  @Cron(CronExpression.EVERY_HOUR)
  async processDuePayouts() {
    this.logger.log('Starting due payouts check...');

    try {
      // Fetch due schedules with minimal needed fields
      const dueSchedules = await this.payoutService.findDuePayouts();

      if (dueSchedules.length === 0) {
        this.logger.debug('No due payouts found');
        return;
      }

      this.logger.log(`Found ${dueSchedules.length} due payouts`);

      // Process sequentially to avoid overwhelming ledger/DB
      for (const due of dueSchedules) {
        const { circleId, cycleNumber, id: scheduleId, circle } = due;

        try {
          // Double-check not already processed (idempotency)
          const existing = await this.prisma.roscaPayout.findFirst({
            where: {
              scheduleId,
              status: { in: [PayoutStatus.COMPLETED, PayoutStatus.PROCESSING] },
            },
          });

          if (existing) {
            this.logger.warn(
              `Skipping already processed payout: Circle ${circle.name || circleId}, Cycle ${cycleNumber}`,
            );
            continue;
          }

          const result = await this.payoutService.processPayout(circleId, cycleNumber);

          this.logger.log(
            `Payout successful: Circle ${circle.name || circleId}, Cycle ${cycleNumber}, ` +
            `Payout ID: ${result.payoutId}, Amount: ₦${Number(result.amount) / 100}`,
          );
        } catch (error) {
          this.logger.error(
            `Payout failed: Circle ${circle.name || circleId}, Cycle ${cycleNumber}`,
            error,
          );

          // Log failure for audit
          await this.payoutService.logPayoutFailure(scheduleId, error as Error);

          // Optional: mark schedule as FAILED or notify admin
          // await this.markScheduleAsFailed(scheduleId, error);
        }
      }
    } catch (error) {
      this.logger.error('Payout scheduler fatal error', error);
      // Optional: send alert (e.g. Slack, email) for fatal scheduler failure
    }
  }

  /**
   * Marks a schedule as skipped/failed after a payout error
   * Prevents endless retry attempts in cron/scheduler
   */
  private async markScheduleAsFailed(scheduleId: string, error: Error): Promise<void> {
    await this.prisma.roscaCycleSchedule.update({
      where: { id: scheduleId },
      data: {
        // Option A: Use existing enum value (recommended if you don't want schema change)
        status: ScheduleStatus.SKIPPED,

        // Option B: If you add a new enum value later (e.g. FAILED)
        // status: ScheduleStatus.FAILED,

        // Optional: Soft-delete/obsolete to prevent future cron picks
        // obsoletedAt: new Date(),
      },
    });

    // Optional: log the failure too (if not already done elsewhere)
    this.logger.warn(`Marked schedule ${scheduleId} as failed: ${error.message}`);
  }
}
