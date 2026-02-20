import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { KycService } from './kyc.service';
import { EmailVerifiedPayload } from '../notification/notitication.types';

@Controller()
export class KycConsumer {
  private readonly logger = new Logger(KycConsumer.name);

  constructor(private readonly kycService: KycService) {}

  @EventPattern('auth.email.verified')
  async handleEmailVerified(@Payload() data: EmailVerifiedPayload) {
    this.logger.log(`Handling auth.email.verified for userId=${data.userId}`);
    await this.kycService.initializeKyc(data.userId);
  }
}
