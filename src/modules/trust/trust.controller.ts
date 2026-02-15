// src/modules/trust/trust.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrustService } from './trust.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Trust Score')
@Controller('trust')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class TrustController {
  constructor(private readonly trustService: TrustService) {}

  @Get('my-score')
  @ApiOperation({ summary: 'Get current user trust statistics' })
  async getMyScore(@CurrentUser('userId') userId: string) {
    const stats = await this.trustService.getTrustScore(userId);
    return {
      success: true,
      data: stats,
    };
  }
}
