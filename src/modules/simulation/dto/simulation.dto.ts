// src/modules/simulation/dto/simulation.dto.ts
import {
  IsString,
  IsInt,
  IsEnum,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Enums ────────────────────────────────────────────────────────────────────

export type TimingType = 'on_time' | 'late' | 'missed';
export type ExtraTrustEventType =
  | 'contribution_on_time'
  | 'contribution_late'
  | 'missed_payment'
  | 'missed_payment_post_payout'
  | 'missed_payment_post_payout_default'
  | 'peer_rating'
  | 'cycle_reset';
export type FrequencyType = 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';
export type PayoutLogicType = 'SEQUENTIAL' | 'RANDOM_DRAW' | 'TRUST_SCORE' | 'COMBINED' | 'ADMIN_ASSIGNED';

// ── Sub-DTOs ─────────────────────────────────────────────────────────────────

export class MemberConfigDto {
  @ApiProperty({ example: 'Alice' })
  @IsString()
  label: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  payoutPosition: number;
}

export class CycleContributionDto {
  @ApiProperty({ example: 'Alice' })
  @IsString()
  member: string;

  @ApiProperty({ enum: ['on_time', 'late', 'missed'] })
  @IsEnum(['on_time', 'late', 'missed'])
  timing: TimingType;
}

export class ExtraTrustEventDto {
  @ApiProperty({ example: 'Alice' })
  @IsString()
  member: string;

  @ApiProperty({
    enum: [
      'contribution_on_time',
      'contribution_late',
      'missed_payment',
      'missed_payment_post_payout',
      'missed_payment_post_payout_default',
      'peer_rating',
      'cycle_reset',
    ],
  })
  @IsEnum([
    'contribution_on_time',
    'contribution_late',
    'missed_payment',
    'missed_payment_post_payout',
    'missed_payment_post_payout_default',
    'peer_rating',
    'cycle_reset',
  ])
  event: ExtraTrustEventType;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPostPayout?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class PeerReviewConfigDto {
  @ApiProperty({ example: 'Alice' })
  @IsString()
  reviewer: string;

  @ApiProperty({ example: 'Bob' })
  @IsString()
  reviewee: string;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class CycleConfigDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  cycleNumber: number;

  @ApiProperty({ type: [CycleContributionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CycleContributionDto)
  contributions: CycleContributionDto[];

  @ApiPropertyOptional({ type: [ExtraTrustEventDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraTrustEventDto)
  extraTrustEvents?: ExtraTrustEventDto[];
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

export class ManualSimConfigDto {
  @ApiProperty({ example: 'Test Circle' })
  @IsString()
  circleName: string;

  @ApiProperty({ example: 100000 })
  @IsInt()
  @Min(1)
  contributionAmountKobo: number;

  @ApiProperty({ example: 4 })
  @IsInt()
  @Min(2)
  maxSlots: number;

  @ApiProperty({ enum: ['WEEKLY', 'BI_WEEKLY', 'MONTHLY'] })
  @IsEnum(['WEEKLY', 'BI_WEEKLY', 'MONTHLY'])
  frequency: FrequencyType;

  @ApiProperty({ enum: ['SEQUENTIAL', 'RANDOM_DRAW', 'TRUST_SCORE', 'COMBINED', 'ADMIN_ASSIGNED'] })
  @IsEnum(['SEQUENTIAL', 'RANDOM_DRAW', 'TRUST_SCORE', 'COMBINED', 'ADMIN_ASSIGNED'])
  payoutLogic: PayoutLogicType;

  @ApiProperty({ type: [MemberConfigDto] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => MemberConfigDto)
  members: MemberConfigDto[];

  @ApiProperty({ type: [CycleConfigDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CycleConfigDto)
  cycles: CycleConfigDto[];

  @ApiPropertyOptional({ type: [PeerReviewConfigDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PeerReviewConfigDto)
  peerReviews?: PeerReviewConfigDto[];
}

// ── Response types ────────────────────────────────────────────────────────────

export interface SimScoreSnapshot {
  memberLabel: string;
  raw: number;
  display: number;
}

export interface SimEventRecord {
  cycle: string;
  event: string;
  scores: SimScoreSnapshot[];
}

export interface SimMemberResult {
  label: string;
  finalRaw: number;
  finalDisplay: number;
}

export interface SimResult {
  runId: string;
  events: SimEventRecord[];
  finalScores: SimMemberResult[];
}

export interface AutoSimResult {
  runId: string;
  circleA: SimResult;
  circleB: SimResult;
  circleC: SimResult;
}
