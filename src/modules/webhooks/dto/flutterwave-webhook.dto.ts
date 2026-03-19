// src/modules/transactions/dto/flutterwave-webhook.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CustomerDto {
  @ApiProperty({ example: 123456 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'user@example.com' })
  @IsString()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: '08012345678' })
  @IsString()
  @IsOptional()
  phone_number?: string;
}

class WebhookDataDto {
  @ApiProperty({ example: 987654321 })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'AJT-FUND-uuid-here' })
  @IsString()
  @IsNotEmpty()
  tx_ref: string;

  @ApiProperty({ example: 1500.0, description: 'Amount in NGN (decimal)' })
  @IsNumber()
  amount: number;

  @ApiProperty({ example: 'NGN' })
  @IsString()
  @IsNotEmpty()
  currency: string;

  @ApiProperty({ example: 'successful', enum: ['successful', 'failed', 'pending'] })
  @IsString()
  @IsNotEmpty()
  status: string;

  @ApiPropertyOptional({ example: 'card' })
  @IsString()
  @IsOptional()
  payment_type?: string;

  @ApiProperty({ type: () => CustomerDto })
  @ValidateNested()
  @Type(() => CustomerDto)
  customer: CustomerDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}

export class FlutterwaveWebhookDto {
  @ApiProperty({
    example: 'charge.completed',
    description: 'Webhook event type',
  })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiProperty({ type: () => WebhookDataDto })
  @ValidateNested()
  @Type(() => WebhookDataDto)
  data: WebhookDataDto;
}

export interface FlwChargeData {
  id: number;           // FLW transaction ID
  tx_ref: string;       // Our internal reference (e.g. AJT-FUND-{uuid})
  flw_ref: string;
  amount: number;       // In Naira
  currency: string;
  charged_amount: number;
  status: 'successful' | 'failed';
  customer: {
    id: number;
    name: string;
    email: string;
    phone_number: string | null;
  };
}

export interface FlwTransferData {
  id: number;
  account_number: string;
  bank_name: string;
  bank_code: string;
  fullname: string;
  created_at: string;
  currency: string;
  amount: number;       // In Naira
  fee: number;
  status: 'SUCCESSFUL' | 'FAILED' | 'NEW' | 'PENDING';
  reference: string;   // Our internal reference (e.g. WITHDRAWAL-{uuid})
  narration: string;
  complete_message: string;
}

export class FlwWebhookPayload {
  event: string;
  'event.type': string;
  data: FlwChargeData | FlwTransferData;
}