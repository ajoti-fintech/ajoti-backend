import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletStatus, BucketType } from '@prisma/client';

/**
 * Response DTO for wallet balance in kobo (Source of Truth representation)
 */
export class WalletBalanceResponseDto {
  @ApiProperty({
    description: 'Total balance in kobo (string to prevent precision loss)',
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
 * Response DTO for wallet balance in Naira (Human-readable)
 */
export class WalletBalanceNairaDto {
  @ApiProperty({ description: 'Total balance in NGN', example: 1000.0 })
  total: number;

  @ApiProperty({ description: 'Reserved balance in NGN', example: 300.0 })
  reserved: number;

  @ApiProperty({ description: 'Available balance in NGN', example: 700.0 })
  available: number;

  @ApiProperty({ description: 'Currency code', example: 'NGN' })
  currency: string;
}

/**
 * Response DTO for wallet information
 */
export class WalletResponseDto {
  @ApiProperty({ description: 'Wallet ID', example: 'uuid-wallet-id' })
  id: string;

  @ApiProperty({ description: 'User ID', example: 'uuid-user-id' })
  userId: string;

  @ApiProperty({ description: 'Currency code', example: 'NGN' })
  currency: string;

  @ApiProperty({
    description: 'Wallet status',
    enum: WalletStatus,
    example: WalletStatus.ACTIVE,
  })
  status: WalletStatus;

  @ApiProperty({ description: 'Creation date' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update date' })
  updatedAt: Date;
}

export class WalletWithBalanceResponseDto extends WalletResponseDto {
  @ApiProperty({ type: WalletBalanceResponseDto })
  balance: WalletBalanceResponseDto;
}

/**
 * DTO for the Bucket response, updated to use sourceId
 */
export class WalletBucketResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  walletId: string;

  @ApiProperty({ enum: BucketType })
  @IsEnum(BucketType)
  bucketType: BucketType;

  @ApiProperty({
    description: 'The unique business origin ID (e.g., ROSCA Circle ID)',
    example: 'uuid-source-id',
  })
  sourceId: string;

  @ApiProperty({ description: 'Reserved amount in kobo' })
  reservedAmount: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class UpdateWalletStatusDto {
  @ApiProperty({ enum: WalletStatus })
  @IsEnum(WalletStatus)
  @IsNotEmpty()
  status: WalletStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class ApiResponseDto<T> {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Operation successful' })
  message: string;

  @ApiProperty({ nullable: true })
  data?: T;
}

// ==========================================
// HELPERS
// ==========================================

/**
 * Convert kobo (BigInt) to Naira (Number)
 */
export function koboToNaira(kobo: bigint): number {
  return Number(kobo) / 100;
}

/**
 * Convert Naira to kobo (BigInt)
 * Uses string-based conversion to avoid floating point math errors
 */
export function nairaToKobo(naira: number): bigint {
  return BigInt(Math.round(Number(naira.toFixed(2)) * 100));
}

/**
 * Formats bigint balance for API response
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
 * Formats balance for Naira-specific endpoints
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
