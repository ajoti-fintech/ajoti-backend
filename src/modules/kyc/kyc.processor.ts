import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { KycService } from './kyc.service';
import { AUTH_EVENTS_QUEUE, AuthJobName } from '../auth/auth.events';
import { EmailVerifiedPayload } from '../notification/notitication.types';

@Processor(AUTH_EVENTS_QUEUE)
export class KycProcessor extends WorkerHost {
  private readonly logger = new Logger(KycProcessor.name);

  constructor(private readonly kycService: KycService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AuthJobName.EMAIL_VERIFIED) return;

    const data = job.data as EmailVerifiedPayload;
    this.logger.log(`email.verified → initializeKyc for userId=${data.userId}`);
    await this.kycService.initializeKyc(data.userId);
  }
}
