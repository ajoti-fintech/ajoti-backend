import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PayoutService } from './payout.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PayoutSchedulerService } from './payout-scheduler.service';
import { ReversePayoutDto } from './dto/payout.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('Payouts')
@Controller('rosca/:circleId/payouts')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Get()
  @ApiOperation({ summary: 'Get payout history for a circle' })
  async getPayoutHistory(@Param('circleId') circleId: string) {
    const history = await this.payoutService.getPayoutHistory(circleId);
    return {
      success: true,
      data: history,
    };
  }
}

// ────────────────────────────────────────────────
// ADMIN PAYOUT CONTROLLER
// ────────────────────────────────────────────────

@ApiTags('Payouts Admin')
@Controller('admin/payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
@ApiBearerAuth('access-token')
export class PayoutAdminController {
  constructor(
    private readonly payoutService: PayoutService,
    private readonly payoutScheduler: PayoutSchedulerService,
  ) {}

  @Post(':circleId/process/:cycleNumber')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Manually trigger payout for a specific cycle' })
  async processPayout(
    @Param('circleId') circleId: string,
    @Param('cycleNumber', ParseIntPipe) cycleNumber: number,
  ) {
    const result = await this.payoutService.processPayout(circleId, cycleNumber);
    return {
      success: true,
      message: 'Payout processed successfully',
      data: result,
    };
  }

  @Post(':payoutId/retry')
  @ApiOperation({ summary: '[Admin] Retry a failed payout' })
  async retryFailedPayout(@Param('payoutId') payoutId: string) {
    const result = await this.payoutService.retryPayout(payoutId);
    return {
      success: true,
      message: 'Payout retry initiated',
      data: result,
    };
  }

  @Post('reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Reverse a payout (compensating ledger entries)' })
  async reversePayout(@Body() dto: ReversePayoutDto) {
    await this.payoutService.reversePayout(dto);
    return {
      success: true,
      message: 'Payout reversed and funds returned to pool',
    };
  }
  /**
   * [ADMIN] Manually trigger payout scheduler (for testing)
   * POST /api/admin/rosca/payouts/trigger
   */
  @Post('trigger-scheduler')
  @ApiOperation({ summary: '[SuperAdmin] Manually force the payout cron job to run' })
  async triggerScheduler() {
    // 2. Call a public method on the service
    await this.payoutScheduler.processDuePayouts();

    return {
      success: true,
      message: 'Payout scheduler executed manually',
    };
  }
}
