// src/modules/simulation/dto/sandbox.dto.ts
import {
  IsString,
  IsInt,
  IsEnum,
  IsOptional,
  IsArray,
  IsNumber,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Enums ─────────────────────────────────────────────────────────────────────

export type SandboxTiming = 'on_time' | 'late' | 'skip';
export type SandboxFrequency = 'WEEKLY' | 'BI_WEEKLY' | 'MONTHLY';
export type SandboxPayoutLogic =
  | 'SEQUENTIAL'
  | 'RANDOM_DRAW'
  | 'TRUST_SCORE'
  | 'COMBINED'
  | 'ADMIN_ASSIGNED';

// ── Request DTOs ──────────────────────────────────────────────────────────────

export class CreateSandboxUsersDto {
  @ApiPropertyOptional({
    example: 'sim_1234',
    description: 'Reuse an existing runId to add users to an ongoing sandbox. Omit to start a new one.',
  })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiProperty({ example: 4, description: 'Number of MEMBER users to create (1–20)' })
  @IsInt()
  @Min(1)
  @Max(20)
  count: number;

  @ApiPropertyOptional({
    example: 10000000,
    description: 'Starting wallet balance in kobo for each user. Defaults to ₦50,000 (5_000_000 kobo).',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fundAmountKobo?: number;
}

export class PayoutAssignmentDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  userId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  position: number;
}

export class CreateSandboxCircleDto {
  @ApiProperty({ example: 'sim_1234' })
  @IsString()
  runId: string;

  @ApiProperty({
    example: ['uuid-1', 'uuid-2'],
    description: 'User IDs to add as members (must already exist in the sim DB for this runId).',
  })
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  memberIds: string[];

  @ApiPropertyOptional({
    example: 'uuid-admin',
    description: 'Existing sim user to act as circle admin. Omit to auto-create one.',
  })
  @IsOptional()
  @IsString()
  adminId?: string;

  @ApiProperty({ example: 'Test Circle' })
  @IsString()
  name: string;

  @ApiProperty({ example: 100000, description: 'Contribution amount in kobo' })
  @IsInt()
  @Min(1)
  contributionAmountKobo: number;

  @ApiProperty({ enum: ['WEEKLY', 'BI_WEEKLY', 'MONTHLY'] })
  @IsEnum(['WEEKLY', 'BI_WEEKLY', 'MONTHLY'])
  frequency: SandboxFrequency;

  @ApiProperty({
    enum: ['SEQUENTIAL', 'RANDOM_DRAW', 'TRUST_SCORE', 'COMBINED', 'ADMIN_ASSIGNED'],
  })
  @IsEnum(['SEQUENTIAL', 'RANDOM_DRAW', 'TRUST_SCORE', 'COMBINED', 'ADMIN_ASSIGNED'])
  payoutLogic: SandboxPayoutLogic;

  @ApiPropertyOptional({
    type: [PayoutAssignmentDto],
    description: 'Required when payoutLogic is ADMIN_ASSIGNED.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayoutAssignmentDto)
  assignments?: PayoutAssignmentDto[];
}

export class CycleContributionEntryDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  userId: string;

  @ApiProperty({
    enum: ['on_time', 'late', 'skip'],
    description: 'on_time = within deadline, late = past deadline (penalty applies), skip = no contribution (missed_payment fired on payout)',
  })
  @IsEnum(['on_time', 'late', 'skip'])
  timing: SandboxTiming;
}

export class RunSandboxCycleDto {
  @ApiProperty({ example: 'circle-uuid' })
  @IsString()
  circleId: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  cycleNumber: number;

  @ApiProperty({ type: [CycleContributionEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CycleContributionEntryDto)
  contributions: CycleContributionEntryDto[];
}

export class ApplySandboxLoanDto {
  @ApiProperty({ example: 'user-uuid' })
  @IsString()
  userId: string;

  @ApiProperty({ example: 'circle-uuid' })
  @IsString()
  circleId: string;
}

// ── Response types ─────────────────────────────────────────────────────────────

export interface SandboxUser {
  id: string;
  label: string;
  email: string;
  walletId: string;
  role: string;
}

export interface SandboxUsersResult {
  runId: string;
  users: SandboxUser[];
}

export interface SandboxCircleResult {
  runId: string;
  circleId: string;
  adminId: string;
  memberIds: string[];
  durationCycles: number;
}

export interface SandboxCycleMemberResult {
  userId: string;
  contributed: boolean;
  timing: SandboxTiming;
  trustScore: { raw: number; display: number };
}

export interface SandboxCycleResult {
  circleId: string;
  cycleNumber: number;
  members: SandboxCycleMemberResult[];
  payout: {
    payoutId: string;
    recipientId: string;
    amount: string;
    isLastCycle: boolean;
    status: string;
  };
}

export interface LedgerEntryRow {
  id: string;
  entryType: string;
  movementType: string;
  bucketType: string;
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  reference: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
}

export interface LedgerInspectResult {
  walletId: string;
  entryCount: number;
  reportedBalance: string;
  computedBalance: string;
  isReconciled: boolean;
  discrepancy: string;
  entries: LedgerEntryRow[];
}

export interface WalletReconcileRow {
  walletId: string;
  userId: string;
  isReconciled: boolean;
  reportedBalance: string;
  computedBalance: string;
  discrepancy: string;
  entryCount: number;
}

export interface ReconcileRunResult {
  runId: string;
  allReconciled: boolean;
  wallets: WalletReconcileRow[];
}
