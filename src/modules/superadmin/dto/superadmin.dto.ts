import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsDateString,
  IsBoolean,
  Min,
  Max,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { UserStatus, Role, KYCStatus } from '@prisma/client';

// ── Shared ────────────────────────────────────────────────────────────────────

export class PaginationDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

// ── User Management ───────────────────────────────────────────────────────────

export class UserFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: KYCStatus })
  @IsOptional()
  @IsEnum(KYCStatus)
  kycStatus?: KYCStatus;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  registeredFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  registeredTo?: string;

  /** Full-text search on firstName, lastName, email, phone */
  @ApiPropertyOptional({ example: 'john' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter users with a pending admin access request' })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' || value === true)
  pendingAdminRequest?: boolean;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status: UserStatus;

  @ApiPropertyOptional({ example: 'Repeated fraudulent activity' })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── KYC ───────────────────────────────────────────────────────────────────────

export class KycQueueFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: KYCStatus, default: KYCStatus.PENDING })
  @IsOptional()
  @IsEnum(KYCStatus)
  status?: KYCStatus = KYCStatus.PENDING;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export class TransactionAnalyticsDto {
  @ApiPropertyOptional({
    enum: ['7d', '30d', '90d', 'custom'],
    default: '30d',
  })
  @IsOptional()
  @IsIn(['7d', '30d', '90d', 'custom'])
  period?: '7d' | '30d' | '90d' | 'custom' = '30d';

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-01-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class GrowthMetricsDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '30d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  period?: '7d' | '30d' | '90d' = '30d';
}

// ── Audit / Ledger ────────────────────────────────────────────────────────────

export class LedgerQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class AuditLogQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ example: 'ROSCA_CIRCLE' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({ example: 'PAYOUT_REVERSED' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class ExportQueryDto {
  @ApiProperty({ enum: ['transactions', 'users', 'ledger', 'circles'] })
  @IsIn(['transactions', 'users', 'ledger', 'circles'])
  type: 'transactions' | 'users' | 'ledger' | 'circles';

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-12-31' })
  @IsDateString()
  endDate: string;
}

// ── ROSCA Governance ──────────────────────────────────────────────────────────

export class CircleGovernanceFilterDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

export class FlagMemberDto {
  @ApiProperty({ example: 'Repeated missed contributions without repayment' })
  @IsString()
  reason: string;
}
