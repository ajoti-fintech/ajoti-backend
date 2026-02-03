import {
  Controller,
  Get,
  Param,
  UseGuards,
  HttpStatus,
  HttpCode,
  Patch,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import {
  WalletBalanceResponseDto,
  WalletWithBalanceResponseDto,
  WalletBucketResponseDto,
  ApiResponseDto,
  formatBalanceResponse,
  formatBalanceNaira,
  WalletBalanceNairaDto,
} from './dto/wallet.dto';
import { LedgerService } from '../ledger/ledger.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get user wallet',
    description:
      'Retrieve the authenticated user wallet. Creates a new wallet if one does not exist.',
  })
  @ApiResponse({ status: 200, type: WalletWithBalanceResponseDto })
  async getWallet(@CurrentUser('userId') userId: string) {
    const walletWithBalance = await this.walletService.getWalletWithBalance(userId);
    return {
      success: true,
      message: 'Wallet retrieved successfully',
      data: walletWithBalance,
    };
  }

  @Get('balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get wallet balance (kobo)' })
  @ApiResponse({ status: 200, type: ApiResponseDto<WalletBalanceResponseDto> })
  async getBalance(@CurrentUser('userId') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const balance = await this.walletService.getBalance(wallet.id);

    return {
      success: true,
      message: 'Balance retrieved successfully',
      data: formatBalanceResponse(balance),
    };
  }

  @Get('balance/naira')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get wallet balance (Naira)' })
  @ApiResponse({ status: 200, type: ApiResponseDto<WalletBalanceNairaDto> })
  async getBalanceNaira(@CurrentUser('userId') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const balance = await this.walletService.getBalance(wallet.id);

    return {
      success: true,
      message: 'Balance retrieved successfully',
      data: formatBalanceNaira(balance),
    };
  }

  @Get('buckets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get wallet buckets' })
  @ApiResponse({ status: 200, type: [WalletBucketResponseDto] })
  async getBuckets(@CurrentUser('userId') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const buckets = await this.walletService.getWalletBuckets(wallet.id);

    // Map Prisma models to DTOs, converting BigInt to string for JSON safety
    const formattedBuckets = buckets.map((bucket) => ({
      id: bucket.id,
      walletId: bucket.walletId,
      bucketType: bucket.bucketType,
      sourceId: bucket.sourceId,
      reservedAmount: bucket.reservedAmount.toString(),
      createdAt: bucket.createdAt,
      updatedAt: bucket.updatedAt,
    }));

    return {
      success: true,
      message: 'Buckets retrieved successfully',
      data: formattedBuckets,
    };
  }

  @Get('statistics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get wallet statistics' })
  @ApiResponse({ status: 200 })
  async getStats(@CurrentUser('userId') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const stats = await this.walletService.getWalletStats(wallet.id);

    return {
      success: true,
      message: 'Statistics retrieved successfully',
      data: stats,
    };
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check wallet status' })
  async getStatus(@CurrentUser('userId') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const isActive = await this.walletService.isWalletActive(wallet.id);
    const canWithdraw = await this.walletService.canWithdraw(wallet.id);

    return {
      success: true,
      message: 'Status retrieved successfully',
      data: {
        walletId: wallet.id,
        status: wallet.status,
        isActive,
        canWithdraw,
        canFund: isActive,
      },
    };
  }

  @Get('balance/check/:amount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check sufficient balance' })
  async checkBalance(@CurrentUser('userId') userId: string, @Param('amount') amount: string) {
    // Defensive check for BigInt parsing
    if (!/^\d+$/.test(amount)) {
      throw new BadRequestException('Amount must be a positive numeric string (kobo)');
    }

    const wallet = await this.walletService.getOrCreateWallet(userId);
    const amountBigInt = BigInt(amount);

    const hasSufficientBalance = await this.walletService.hasSufficientBalance(
      wallet.id,
      amountBigInt,
    );

    const balance = await this.walletService.getBalance(wallet.id);

    return {
      success: true,
      message: 'Balance check completed',
      data: {
        requestedAmount: amount,
        availableBalance: balance.available.toString(),
        hasSufficientBalance,
      },
    };
  }
  /**
   * Get transaction history from the Ledger
   */
  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get transaction history' })
  async getTransactions(
    @CurrentUser('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const wallet = await this.walletService.getOrCreateWallet(userId);

    const transactions = await this.ledgerService.getHistory(wallet.id, {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    });

    // Format BigInt for JSON serialisation
    const formatted = transactions.map((tx) => ({
      ...tx,
      amount: tx.amount.toString(),
      balanceBefore: tx.balanceBefore.toString(),
      balanceAfter: tx.balanceAfter.toString(),
    }));

    return {
      success: true,
      message: 'Transaction history retrieved successfully',
      data: formatted,
    };
  }
}

/**
 * Admin wallet controller
 */
@ApiTags('Wallet Admin')
@Controller('admin/wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
@ApiBearerAuth('access-token')
export class WalletAdminController {
  constructor(private readonly walletService: WalletService) {}

  @Get('user/:userId')
  @ApiOperation({ summary: '[Admin] Get user wallet by User ID' })
  async getUserWallet(@Param('userId') userId: string) {
    const walletWithBalance = await this.walletService.getWalletWithBalance(userId);
    return {
      success: true,
      message: 'Wallet retrieved successfully',
      data: walletWithBalance,
    };
  }

  @Patch(':walletId/freeze')
  @ApiOperation({ summary: '[Admin] Freeze wallet' })
  async freezeWallet(@Param('walletId') walletId: string) {
    const wallet = await this.walletService.freezeWallet(walletId);
    return {
      success: true,
      message: 'Wallet frozen successfully',
      data: wallet,
    };
  }

  @Patch(':walletId/unfreeze')
  @ApiOperation({ summary: '[Admin] Unfreeze wallet' })
  async unfreezeWallet(@Param('walletId') walletId: string) {
    const wallet = await this.walletService.unfreezeWallet(walletId);
    return {
      success: true,
      message: 'Wallet unfrozen successfully',
      data: wallet,
    };
  }
}
