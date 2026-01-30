import { Controller, Get, Param, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  WalletBalanceResponseDto,
  WalletWithBalanceResponseDto,
  WalletStatsResponseDto,
  WalletBucketResponseDto,
  ApiResponseDto,
  formatBalanceResponse,
  formatBalanceNaira,
  WalletBalanceNairaDto,
} from './dto/wallet.dto';

@ApiTags('Wallet')
@Controller('wallet')
// @UseGuards(AuthGuard) // Uncomment when auth is ready
@ApiBearerAuth() // Swagger auth documentation
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Get current user's wallet
   * Creates wallet if it doesn't exist
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get user wallet',
    description:
      'Retrieve the authenticated user wallet. Creates a new wallet if one does not exist.',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallet retrieved successfully',
    type: WalletWithBalanceResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing authentication token',
  })
  async getWallet(@CurrentUser('id') userId: string) {
    const walletWithBalance = await this.walletService.getWalletWithBalance(userId);

    return {
      success: true,
      message: 'Wallet retrieved successfully',
      data: walletWithBalance,
    };
  }

  /**
   * Get wallet balance (in kobo)
   * Returns balance in smallest unit (kobo) as strings
   */
  @Get('balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get wallet balance',
    description:
      'Retrieve the authenticated user wallet balance. Balance is derived from the ledger (not stored).',
  })
  @ApiResponse({
    status: 200,
    description: 'Balance retrieved successfully',
    type: ApiResponseDto<WalletBalanceResponseDto>,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  @ApiResponse({
    status: 404,
    description: 'Wallet not found',
  })
  async getBalance(@CurrentUser('id') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const balance = await this.walletService.getBalance(wallet.id);

    return {
      success: true,
      message: 'Balance retrieved successfully',
      data: formatBalanceResponse(balance),
    };
  }

  /**
   * Get wallet balance in Naira (human-readable)
   * Returns balance converted to NGN as decimal numbers
   */
  @Get('balance/naira')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get wallet balance in Naira',
    description: 'Retrieve wallet balance in Naira (NGN) as decimal numbers for display purposes.',
  })
  @ApiResponse({
    status: 200,
    description: 'Balance retrieved successfully',
    type: ApiResponseDto<WalletBalanceNairaDto>,
  })
  async getBalanceNaira(@CurrentUser('id') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const balance = await this.walletService.getBalance(wallet.id);

    return {
      success: true,
      message: 'Balance retrieved successfully',
      data: formatBalanceNaira(balance),
    };
  }

  /**
   * Get wallet statistics
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get wallet statistics',
    description:
      'Retrieve statistics about the wallet including transaction counts and last activity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
    type: ApiResponseDto<WalletStatsResponseDto>,
  })
  async getStats(@CurrentUser('id') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const stats = await this.walletService.getWalletStats(wallet.id);

    return {
      success: true,
      message: 'Statistics retrieved successfully',
      data: stats,
    };
  }

  /**
   * Get wallet buckets (fund reservations)
   */
  @Get('buckets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get wallet buckets',
    description: 'Retrieve all buckets (fund reservations) for the user wallet.',
  })
  @ApiResponse({
    status: 200,
    description: 'Buckets retrieved successfully',
    type: [WalletBucketResponseDto],
  })
  async getBuckets(@CurrentUser('id') userId: string) {
    const wallet = await this.walletService.getOrCreateWallet(userId);
    const buckets = await this.walletService.getWalletBuckets(wallet.id);

    // Format buckets for response (convert BigInt to string)
    const formattedBuckets = buckets.map((bucket) => ({
      ...bucket,
      reservedAmount: bucket.reservedAmount.toString(),
    }));

    return {
      success: true,
      message: 'Buckets retrieved successfully',
      data: formattedBuckets,
    };
  }

  /**
   * Check wallet status
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check wallet status',
    description: 'Check if wallet is active and can perform operations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Status retrieved successfully',
  })
  async getStatus(@CurrentUser('id') userId: string) {
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
        canFund: isActive, // Only active wallets can receive funds
      },
    };
  }

  /**
   * Check if wallet has sufficient balance
   * Useful for frontend validation before initiating transactions
   */
  @Get('balance/check/:amount')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check sufficient balance',
    description: 'Check if wallet has sufficient available balance for a given amount (in kobo).',
  })
  @ApiResponse({
    status: 200,
    description: 'Balance check completed',
  })
  async checkBalance(@CurrentUser('id') userId: string, @Param('amount') amount: string) {
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
}

/**
 * Admin wallet controller (separate from user endpoints)
 * These endpoints should have admin guards
 */
@ApiTags('Wallet Admin')
@Controller('admin/wallet')
// @UseGuards(AuthGuard, AdminGuard) // Uncomment when auth is ready
@ApiBearerAuth()
export class WalletAdminController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Get any user's wallet by userId (admin only)
   */
  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Get user wallet',
    description: 'Retrieve any user wallet by their user ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallet retrieved successfully',
  })
  async getUserWallet(@Param('userId') userId: string) {
    const walletWithBalance = await this.walletService.getWalletWithBalance(userId);

    return {
      success: true,
      message: 'Wallet retrieved successfully',
      data: walletWithBalance,
    };
  }

  /**
   * Get wallet by wallet ID (admin only)
   */
  @Get(':walletId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Get wallet by ID',
    description: 'Retrieve wallet by wallet ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallet retrieved successfully',
  })
  async getWalletById(@Param('walletId') walletId: string) {
    const wallet = await this.walletService.getWalletById(walletId);
    const balance = await this.walletService.getBalance(walletId);

    return {
      success: true,
      message: 'Wallet retrieved successfully',
      data: {
        ...wallet,
        balance: formatBalanceResponse(balance),
      },
    };
  }

  /**
   * Freeze wallet (admin only)
   */
  @Get(':walletId/freeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Freeze wallet',
    description: 'Suspend wallet operations.',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallet frozen successfully',
  })
  async freezeWallet(@Param('walletId') walletId: string) {
    const wallet = await this.walletService.freezeWallet(walletId);

    return {
      success: true,
      message: 'Wallet frozen successfully',
      data: wallet,
    };
  }

  /**
   * Unfreeze wallet (admin only)
   */
  @Get(':walletId/unfreeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Unfreeze wallet',
    description: 'Reactivate a frozen wallet.',
  })
  @ApiResponse({
    status: 200,
    description: 'Wallet unfrozen successfully',
  })
  async unfreezeWallet(@Param('walletId') walletId: string) {
    const wallet = await this.walletService.unfreezeWallet(walletId);

    return {
      success: true,
      message: 'Wallet unfrozen successfully',
      data: wallet,
    };
  }
}
