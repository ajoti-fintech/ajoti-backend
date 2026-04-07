import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CreditService } from './credit.service';

@ApiTags('Credit Score')
@Controller('credit-score')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @Get()
  @ApiOperation({ summary: 'Get your composite credit score' })
  async getMyCreditScore(@CurrentUser('userId') userId: string) {
    const result = await this.creditService.getFinalCreditScore(userId);
    return {
      success: true,
      data: result,
    };
  }
}
