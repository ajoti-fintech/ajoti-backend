import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletStatus } from '@prisma/client';

/**
 * Response DTO for wallet balance
 */
export class WalletBalanceResponseDto {
  @ApiProperty({
    description: 'Total balance in kobo',
    example: '100000',
  })
  total: string;

  @ApiProperty({
    description: 'Reserved balance in kobo (locked in buckets)',
    example: '30000',
  })
  reserved: string;

  @ApiProperty({
    description: 'Available balance in kobo (can be spent)',
    example: '70000',
  })
  available: string;

  @ApiProperty({
    description: 'Currency code',
    example: 'NGN',
  })
  currency: string;
}

/**
 * Response DTO for wallet balance in Naira (human-readable)
 */
export class WalletBalanceNairaDto {
  @ApiProperty({
    description: 'Total balance in NGN',
    example: 1000.0,
  })
  total: number;

  @ApiProperty({
    description: 'Reserved balance in NGN',
    example: 300.0,
  })
  reserved: number;

  @ApiProperty({
    description: 'Available balance in NGN',
    example: 700.0,
  })
  available: number;

  @ApiProperty({
    description: 'Currency code',
    example: 'NGN',
  })
  currency: string;
}

/**
 * Response DTO for wallet information
 */
export class WalletResponseDto {
  @ApiProperty({
    description: 'Wallet ID',
    example: 'uuid-wallet-id',
  })
  id: string;

  @ApiProperty({
    description: 'User ID',
    example: 'uuid-user-id',
  })
  userId: string;

  @ApiProperty({
    description: 'Currency code',
    example: 'NGN',
  })
  currency: string;

  @ApiProperty({
    description: 'Wallet status',
    enum: WalletStatus,
    example: WalletStatus.ACTIVE,
  })
  status: WalletStatus;

  @ApiProperty({
    description: 'Wallet creation date',
    example: '2024-01-29T12:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Wallet last update date',
    example: '2024-01-29T12:00:00Z',
  })
  updatedAt: Date;
}

/**
 * Response DTO for wallet with balance
 */
export class WalletWithBalanceResponseDto extends WalletResponseDto {
  @ApiProperty({
    description: 'Wallet balance information',
    type: WalletBalanceResponseDto,
  })
  balance: WalletBalanceResponseDto;
}

/**
 * Response DTO for wallet statistics
 */
export class WalletStatsResponseDto {
  @ApiProperty({
    description: 'Total number of transactions',
    example: 42,
  })
  totalTransactions: number;

  @ApiProperty({
    description: 'Total number of credit transactions',
    example: 20,
  })
  totalCredits: number;

  @ApiProperty({
    description: 'Total number of debit transactions',
    example: 22,
  })
  totalDebits: number;

  @ApiProperty({
    description: 'Date of last transaction',
    example: '2024-01-29T12:00:00Z',
    nullable: true,
  })
  lastTransaction: Date | null;
}

/**
 * DTO for updating wallet status (admin only)
 */
export class UpdateWalletStatusDto {
  @ApiProperty({
    description: 'New wallet status',
    enum: WalletStatus,
    example: WalletStatus.RESTRICTED,
  })
  @IsEnum(WalletStatus)
  @IsNotEmpty()
  status: WalletStatus;

  @ApiProperty({
    description: 'Reason for status change',
    example: 'Suspicious activity detected',
    required: false,
  })
  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Response DTO for bucket information
 */
export class WalletBucketResponseDto {
  @ApiProperty({
    description: 'Bucket ID',
    example: 'uuid-bucket-id',
  })
  id: string;

  @ApiProperty({
    description: 'Wallet ID',
    example: 'uuid-wallet-id',
  })
  walletId: string;

  @ApiProperty({
    description: 'Bucket type',
    example: 'ROSCA',
  })
  bucketType: string;

  @ApiProperty({
    description: 'Reserved amount in kobo',
    example: '50000',
  })
  reservedAmount: string;

  @ApiProperty({
    description: 'Bucket creation date',
    example: '2024-01-29T12:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Bucket last update date',
    example: '2024-01-29T12:00:00Z',
  })
  updatedAt: Date;
}

/**
 * Standard API response wrapper
 */
export class ApiResponseDto<T> {
  @ApiProperty({
    description: 'Indicates if request was successful',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Response message',
    example: 'Operation completed successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Response data',
  })
  data?: T;
}

/**
 * Helper function to convert kobo to Naira
 */
export function koboToNaira(kobo: bigint): number {
  return Number(kobo) / 100;
}

/**
 * Helper function to convert Naira to kobo
 */
export function nairaToKobo(naira: number): bigint {
  return BigInt(Math.round(naira * 100));
}

/**
 * Helper function to format balance for API response
 */
export function formatBalanceResponse(balance: {
  total: bigint;
  reserved: bigint;
  available: bigint;
}): WalletBalanceResponseDto {
  return {
    total: balance.total.toString(),
    reserved: balance.reserved.toString(),
    available: balance.available.toString(),
    currency: 'NGN',
  };
}

/**
 * Helper function to format balance in Naira
 */
export function formatBalanceNaira(balance: {
  total: bigint;
  reserved: bigint;
  available: bigint;
}): WalletBalanceNairaDto {
  return {
    total: koboToNaira(balance.total),
    reserved: koboToNaira(balance.reserved),
    available: koboToNaira(balance.available),
    currency: 'NGN',
  };
}
