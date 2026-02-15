import { IsNumber, IsEnum, IsOptional, Min, IsString, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum PaymentMethod {
  CARD = 'CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  USSD = 'USSD',
}

export class InitializeFundingDto {
  @ApiProperty({ description: 'Amount in kobo (₦1 = 100)', example: 500000 })
  @IsInt() // Ensures no floating point issues
  @Min(10000)
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CARD })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiProperty({ required: false, example: 'https://app.ajoti.com/dashboard' })
  @IsOptional()
  @IsString() // Fixed: Now needs to be imported
  redirectUrl?: string;
}

// Better practice: Define the nested data as its own class/interface for Swagger
class FundingData {
  @ApiProperty()
  reference!: string;

  @ApiProperty({ required: false })
  authorizationUrl?: string;

  @ApiProperty({ required: false })
  accountNumber?: string;

  @ApiProperty({ required: false })
  bankName?: string;

  @ApiProperty({ required: false })
  accountName?: string;

  @ApiProperty()
  expiresAt!: Date;
}

export class FundingResponseDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty()
  message!: string;

  @ApiProperty({ type: FundingData })
  data!: FundingData;
}
