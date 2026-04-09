import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  FUNDING_RECONCILIATION_QUEUE,
  FundingReconciliationJobData,
  FundingReconciliationJobName,
} from './funding.queue';
import { FundingReconciliationScheduler } from './funding-reconciliation.scheduler';

@Processor(FUNDING_RECONCILIATION_QUEUE)
export class FundingReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(FundingReconciliationProcessor.name);

  constructor(
    private readonly fundingReconciliationScheduler: FundingReconciliationScheduler,
  ) {
    super();
  }

  async process(job: Job<FundingReconciliationJobData>, token?: string): Promise<void> {
    if (job.name !== FundingReconciliationJobName.VERIFY_PENDING) {
      this.logger.warn(`Ignoring unknown funding reconciliation job: ${job.name}`);
      return;
    }

    await this.fundingReconciliationScheduler.processQueuedVerification(job, token);
  }
}
