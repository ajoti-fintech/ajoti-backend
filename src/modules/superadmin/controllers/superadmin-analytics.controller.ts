import { Controller, Get, Query, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { SuperadminAnalyticsService } from '../superadmin-analytics.service';
import { TransactionAnalyticsDto, GrowthMetricsDto } from '../dto/superadmin.dto';

@ApiTags('Super Admin — Analytics')
@Controller('superadmin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class SuperadminAnalyticsController {
  constructor(private readonly analyticsService: SuperadminAnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Platform dashboard snapshot',
    description:
      'Aggregated platform-wide counts: users by status, circles by status, KYC counts, ' +
      'total user wallet balances, platform pool balance, and outstanding debt count.',
  })
  async getDashboard() {
    return this.analyticsService.getDashboard();
  }

  @Get('wallet')
  @ApiOperation({
    summary: 'Wallet balance aggregator',
    description: 'Total user wallet balances (sum of latest ledger balanceAfter per wallet) and platform pool balance.',
  })
  async getWalletSummary() {
    return this.analyticsService.getWalletSummary();
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'Inflow / outflow / fee analytics',
    description:
      'Transaction analytics for a given period (7d / 30d / 90d / custom). ' +
      'Returns totals and daily buckets for inflow, outflow, and platform fee revenue.',
  })
  async getTransactionAnalytics(@Query() dto: TransactionAnalyticsDto) {
    return this.analyticsService.getTransactionAnalytics(dto);
  }

  @Get('growth')
  @ApiOperation({
    summary: 'User and circle growth metrics',
    description:
      'Compares current period vs previous period for user and circle registrations. ' +
      'Includes delta, percent change, and daily time-series.',
  })
  async getGrowthMetrics(@Query() dto: GrowthMetricsDto) {
    return this.analyticsService.getGrowthMetrics(dto);
  }

  @Delete('reset-balances')
  @ApiOperation({ summary: '[Dev] Zero out all wallet balances by clearing ledger entries and buckets' })
  async resetAllBalances() {
    const data = await this.analyticsService.resetAllBalances();
    return { success: true, message: 'All wallet balances cleared', data };
  }

  @Get('wallets')
  @ApiOperation({ summary: 'List all user wallets with balances' })
  async listWallets(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.analyticsService.listWallets({
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
      search,
      status,
    });
  }
}
