import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthResponseDto } from './dto/health-response.dto';
import { minutes, Throttle } from '@nestjs/throttler';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Throttle({ default: { ttl: minutes(2), limit: 5 } })
  check(): HealthResponseDto {
    return this.healthService.check();
  }
}
