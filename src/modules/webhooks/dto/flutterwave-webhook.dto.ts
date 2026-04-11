// src/modules/webhooks/dto/flutterwave-webhook.dto.ts
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

/**
 * Shape of the data object inside a charge.completed webhook.
 *
 * payment_type values FLW sends for NGN:
 *   'card'          — debit/credit card via hosted checkout or inline
 *   'bank_transfer' — bank transfer via hosted checkout OR virtual account credit
 *   'account'       — direct bank debit
 *   'ussd'          — USSD payment
 *
 * For virtual account credits, payment_type is always 'bank_transfer'
 * and tx_ref is the static AJOTI-VA-{userId} reference.
 * Use flw_ref (unique per payment) as the ledger idempotency key for VA credits.
 */
export interface FlwChargeData {
  id: number;             // FLW numeric transaction ID — use for verifyTransaction()
  tx_ref: string;         // Our reference (AJT-FUND-{uuid} or AJOTI-VA-{userId})
  flw_ref: string;        // FLW's own reference — unique per payment, use for VA idempotency
  amount: number;         // In Naira (decimal) — multiply by 100 to get kobo
  currency: string;
  charged_amount: number;
  status: 'successful' | 'failed';
  /**
   * How the customer paid.
   * Critical for routing VA credits vs hosted checkout credits in the webhook handler.
   */
  payment_type: string;
  customer: {
    id: number;
    name: string;
    email: string;
    phone_number: string | null;
  };
}

export interface FlwWebhookMetaData {
  originatoraccountnumber?: string;
  originatorname?: string;
  bankname?: string;
  originatoramount?: string | number;
  [key: string]: unknown;
}

export interface FlwTransferData {
  id: number;
  account_number: string;
  bank_name: string;
  bank_code: string;
  fullname: string;
  created_at: string;
  currency: string;
  amount: number;         // In Naira
  fee: number;
  status: 'SUCCESSFUL' | 'FAILED' | 'NEW' | 'PENDING';
  reference: string;      // Our internal reference (WITHDRAWAL-{uuid})
  narration: string;
  complete_message: string;
}

export class FlwWebhookPayload {
  @ApiProperty({
    example: 'charge.completed',
    description: 'Flutterwave event type',
  })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiPropertyOptional({
    name: 'event.type',
    example: 'CARD_TRANSACTION',
    description: 'Flutterwave event subtype',
  })
  @IsOptional()
  @IsString()
  'event.type'?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Provider event payload body',
  })
  @IsObject()
  data: FlwChargeData | FlwTransferData;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Optional top-level Flutterwave metadata (e.g. originator account details for bank transfers)',
  })
  @IsOptional()
  @IsObject()
  meta_data?: FlwWebhookMetaData;
}
