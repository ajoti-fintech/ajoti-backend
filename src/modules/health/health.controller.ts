import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthResponseDto } from './dto/health-response.dto';
import { SkipThrottle } from '@nestjs/throttler';
import axios from 'axios';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): HealthResponseDto {
    return this.healthService.check();
  }

  // In any controller, e.g. app.controller.ts
  @Get('debug/ip')
  async getIp() {
    const res = await axios.get('https://api.ipify.org?format=json');
    return res.data;
  }
}
