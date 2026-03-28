// src/modules/funding/dto/funding.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsObject,
  IsIn,
} from 'class-validator';

export class InitializeFundingDto {
  @ApiProperty({
    example: 50000,
    description: 'Amount in kobo (smallest unit, e.g. 50000 = ₦500)',
    minimum: 100,
    maximum: 1000000000,
  })
  @IsNumber({ allowInfinity: false, maxDecimalPlaces: 0 }, { message: 'Amount must be integer' })
  @IsNotEmpty()
  @Min(100, { message: 'Minimum funding amount is ₦1.00 (100 kobo)' })
  @Max(1000000000, { message: 'Maximum funding amount is ₦10,000,000' })
  amount: number;

  @ApiProperty({
    example: 'https://ajoti.com/funding/callback',
    description: 'Redirect URL after payment completion',
  })
  @IsString()
  @IsNotEmpty()
  redirectUrl: string;

  @ApiPropertyOptional({
    example: 'NGN',
    default: 'NGN',
    description: 'Currency — only NGN supported',
  })
  @IsString()
  @IsOptional()
  @IsIn(['NGN'], { message: 'Only NGN (Nigerian Naira) is supported' })
  currency?: string = 'NGN';

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    example: { source: 'mobile', userAgent: 'iOS 18' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class FundingResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'Funding session initialized' })
  message: string;

  @ApiProperty({
    type: 'object',
    properties: {
      reference: { type: 'string', example: 'AJT-FUND-uuid-here' },
      authorizationUrl: { type: 'string', example: 'https://checkout.flutterwave.com/...' },
      provider: { type: 'string', example: 'FLUTTERWAVE' },
    },
  })
  data: {
    reference: string;
    authorizationUrl: string;
    provider: string;
  };
}
