// src/modules/trust/dto/trust-admin.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsIn,
  IsOptional,
  IsNumber,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TrustStatsQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Records per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Minimum internal trust score (0–100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ description: 'Maximum internal trust score (0–100)', minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxScore?: number;
}

// Valid event types that a superadmin can fire manually
const VALID_EVENT_TYPES = [
  'contribution_on_time',
  'contribution_late',
  'missed_payment',
  'missed_payment_post_payout',
  'missed_payment_post_payout_default',
  'peer_rating',
  'cycle_reset',
] as const;

export type AdminEventType = (typeof VALID_EVENT_TYPES)[number];

export class FireTrustEventDto {
  @ApiProperty({
    description: 'The type of trust event to fire',
    enum: VALID_EVENT_TYPES,
    example: 'missed_payment',
  })
  @IsIn(VALID_EVENT_TYPES)
  eventType!: AdminEventType;

  @ApiPropertyOptional({
    description: 'Required when eventType is "peer_rating". Must be 1–5.',
    minimum: 1,
    maximum: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({
    description: 'For contribution events: whether this is after the member received their payout',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPostPayout?: boolean;
}
