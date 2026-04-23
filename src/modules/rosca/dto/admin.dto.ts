// src/modules/rosca/dto/admin.dto.ts
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CircleStatus, PayoutStatus, ScheduleStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class JoinRequestSearchQueryDto {
  @ApiPropertyOptional({ description: 'Search requesters by name within the selected group' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class AdminListCirclesQueryDto {
  @IsOptional()
  @IsEnum(CircleStatus)
  status?: CircleStatus;

  @IsOptional()
  @IsString()
  adminId?: string;
}

export class RoundQueryDto {
  @ApiPropertyOptional({
    example: 2,
    description: 'Cycle number to filter by. Defaults to currentCycle.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  round?: number;
}

export class NotifyMembersDto {
  @ApiPropertyOptional({ description: 'Custom reminder message' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({ description: 'Specific member user IDs to notify. Leave empty for all missing.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[];
}

// ── Dashboard ───────────────────────────────────

export class DashboardNextDeadlineDto {
  @ApiProperty({ example: 'January Savers' }) groupName!: string;
  @ApiProperty({ example: '2026-05-01T10:00:00.000Z' }) deadline!: Date;
}

export class DashboardPendingBreakdownDto {
  @ApiProperty({ example: 'January Savers' }) groupName!: string;
  @ApiProperty({ example: 3 }) pendingCount!: number;
}

export class DashboardPendingRequestsDto {
  @ApiProperty({ example: 7 }) total!: number;
  @ApiProperty({ type: [DashboardPendingBreakdownDto] }) breakdown!: DashboardPendingBreakdownDto[];
}

export class AdminDashboardResponseDto {
  @ApiProperty({ example: 4 }) totalGroups!: number;
  @ApiProperty({ type: DashboardNextDeadlineDto, nullable: true })
  nextDeadline!: DashboardNextDeadlineDto | null;
  @ApiProperty({ type: DashboardPendingRequestsDto })
  pendingJoinRequests!: DashboardPendingRequestsDto;
}

// ── Join Request Management ─────────────────────

export class PendingCircleOverviewDto {
  @ApiProperty() circleId!: string;
  @ApiProperty({ example: 'January Savers' }) name!: string;
  @ApiProperty({ example: 3 }) pendingCount!: number;
  @ApiProperty({ example: '2026-04-01T08:00:00.000Z', nullable: true })
  oldestRequestAt!: Date | null;
}

export class JoinRequesterDossierDto {
  @ApiProperty() userId!: string;
  @ApiProperty() membershipId!: string;
  @ApiProperty({ example: 'John Doe' }) name!: string;
  @ApiProperty({ example: '2026-04-01T08:00:00.000Z' }) requestedAt!: Date;
  @ApiProperty({ example: 658, description: 'ATI display score (300–850)' }) trustScore!: number;
  @ApiProperty({
    example: 87,
    nullable: true,
    description: 'Percentage of payments made on time. Null if no payment history.',
  })
  onTimePaymentRate!: number | null;
  @ApiProperty({ example: 4, description: 'Number of ROSCA cycles completed across all groups' })
  completedCycles!: number;
}

// ── Tab 1: Member Progress ──────────────────────

export class MemberProgressItemDto {
  @ApiProperty() userId!: string;
  @ApiProperty({ example: 'Jane Doe' }) name!: string;
  @ApiProperty({ example: 3 }) completedCycles!: number;
  @ApiProperty({ example: 7 }) durationCycles!: number;
  @ApiProperty({ enum: ['PAID', 'UPCOMING'] }) payoutStatus!: 'PAID' | 'UPCOMING';
  @ApiProperty({ nullable: true }) payoutPosition!: number | null;
  @ApiProperty({ example: 1 }) totalLatePayments!: number;
}

export class MemberProgressResponseDto {
  @ApiProperty() circleId!: string;
  @ApiProperty() durationCycles!: number;
  @ApiProperty({ type: [MemberProgressItemDto] }) members!: MemberProgressItemDto[];
}

// ── Tab 2a: Contributions In ────────────────────

export class ContributionInItemDto {
  @ApiProperty() contributionId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ example: 'Jane Doe' }) memberName!: string;
  @ApiProperty({ example: '500000' }) amount!: string;
  @ApiProperty({ example: '10000' }) penaltyAmount!: string;
  @ApiProperty() isLate!: boolean;
  @ApiProperty() paidAt!: Date;
}

export class ContributionsInResponseDto {
  @ApiProperty() circleId!: string;
  @ApiProperty() cycleNumber!: number;
  @ApiProperty({ type: [ContributionInItemDto] }) contributions!: ContributionInItemDto[];
  @ApiProperty({ example: '1500000' }) totalCollected!: string;
  @ApiProperty({ example: '30000' }) totalPenalties!: string;
}

// ── Tab 2b: Disbursement Schedule ──────────────

export class DisbursementScheduleItemDto {
  @ApiProperty() cycleNumber!: number;
  @ApiProperty({ nullable: true }) recipientId!: string | null;
  @ApiProperty({ nullable: true }) recipientName!: string | null;
  @ApiProperty() payoutDate!: Date;
  @ApiProperty() contributionDeadline!: Date;
  @ApiProperty({ enum: ScheduleStatus }) scheduleStatus!: ScheduleStatus;
  @ApiProperty({ enum: PayoutStatus, nullable: true }) payoutStatus!: PayoutStatus | null;
  @ApiProperty({ example: '3500000', nullable: true }) amountPaidOut!: string | null;
  @ApiProperty({ nullable: true }) processedAt!: Date | null;
}

export class DisbursementScheduleResponseDto {
  @ApiProperty() circleId!: string;
  @ApiProperty({ type: [DisbursementScheduleItemDto] }) schedules!: DisbursementScheduleItemDto[];
}

// ── Tab 3: Financial Health ─────────────────────

export class CycleFinancialHealthDto {
  @ApiProperty() cycleNumber!: number;
  @ApiProperty() contributionDeadline!: Date;
  @ApiProperty({ enum: ScheduleStatus }) scheduleStatus!: ScheduleStatus;
  @ApiProperty({ example: '3500000', description: 'contributionAmount × filledSlots' })
  expectedPot!: string;
  @ApiProperty({ example: '2500000' }) collected!: string;
  @ApiProperty({ example: '1000000' }) outstanding!: string;
  @ApiProperty({ example: 7 }) expectedCount!: number;
  @ApiProperty({ example: 5 }) collectedCount!: number;
}

export class FinancialHealthResponseDto {
  @ApiProperty() circleId!: string;
  @ApiProperty({ example: '500000' }) contributionAmount!: string;
  @ApiProperty() filledSlots!: number;
  @ApiProperty({ type: [CycleFinancialHealthDto] }) cycles!: CycleFinancialHealthDto[];
}
