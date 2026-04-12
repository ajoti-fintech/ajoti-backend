// src/modules/rosca/dto/rosca.dto.ts
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  Max,
  IsBoolean,
  IsDateString,
  registerDecorator,
  ValidationOptions,
  IsInt,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CircleStatus,
  MembershipStatus,
  CycleFrequency,
  PayoutLogic,
  ScheduleStatus,
  CircleVisibility, // Added this since it was used in your DTO
} from '@prisma/client';
import { Type } from 'class-transformer';
import { PayoutStatus } from '@prisma/client';

// ────────────────────────────────────────────────
// Custom validator
// ────────────────────────────────────────────────
export function IsPositiveIntegerString(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPositiveIntegerString',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          if (!/^\d+$/.test(value)) return false;
          if (value.startsWith('0') && value.length > 1) return false;
          if (value === '0') return false;
          return true;
        },
        defaultMessage() {
          return 'Must be a string representing a positive integer';
        },
      },
    });
  };
}

// ────────────────────────────────────────────────
// REQUEST DTOs
// ────────────────────────────────────────────────

export class CreateRoscaCircleDto {
  @ApiProperty({ example: 'January Savers' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Saving for the new year' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: '500000', description: 'in kobo' })
  @IsString()
  @IsNotEmpty()
  @IsPositiveIntegerString()
  contributionAmount!: string;

  @ApiProperty({ enum: CycleFrequency, example: CycleFrequency.MONTHLY })
  @IsEnum(CycleFrequency)
  frequency!: CycleFrequency;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(2)
  @Max(50)
  durationCycles!: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(2)
  @Max(50)
  maxSlots!: number;

  @ApiProperty({ enum: PayoutLogic, example: PayoutLogic.TRUST_SCORE })
  @IsEnum(PayoutLogic)
  payoutLogic!: PayoutLogic;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  autoStartOnFull?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEnum(CircleVisibility)
  visibility?: CircleVisibility;

}

export class ActivateCircleDto {
  @ApiProperty({
    example: '2026-03-01T00:00:00Z',
    description:
      'The deadline by which all members must make their first contribution. Payout occurs 24 hours after this.',
  })
  @IsDateString()
  @IsNotEmpty()
  initialContributionDeadline!: string;
}

export class ListCirclesQueryDto {
  @ApiPropertyOptional({
    enum: CircleStatus,
    description: 'Filter circles by their current state (e.g., DRAFT, ACTIVE)',
  })
  @IsOptional()
  @IsEnum(CircleStatus)
  status?: CircleStatus;

  @ApiPropertyOptional({
    description: 'Search circles by name (case-insensitive)',
  })
  @IsOptional()
  @IsString()
  name?: string;
}

export class UpdateCircleDto {
  @ApiPropertyOptional({ example: 'Updated Savings Group' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Saving for the new year' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '10000', description: 'in kobo' })
  @IsString()
  @IsOptional()
  @IsPositiveIntegerString()
  contributionAmount?: string;

  @ApiPropertyOptional({ example: 12 })
  @IsInt()
  @Min(2)
  @Max(50)
  @IsOptional()
  maxSlots?: number;

  @ApiPropertyOptional({
    example: '2026-06-01T00:00:00Z',
    description: 'The deadline for the first contribution. Payout occurs 24 hours after this.',
  })
  @IsDateString()
  @IsOptional()
  initialContributionDeadline?: string;

  @ApiPropertyOptional({ enum: PayoutLogic })
  @IsEnum(PayoutLogic)
  @IsOptional()
  payoutLogic?: PayoutLogic;
}

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

// ────────────────────────────────────────────────
// RESPONSE DTOs
// ────────────────────────────────────────────────

export class AdminResponseDto {
  @ApiProperty({ example: 'Jason' })
  firstName!: string;

  @ApiProperty({ example: 'Maxim' })
  lastName!: string;

  @ApiProperty({ example: 'admin@ajoti.com' })
  email!: string;
}

export class RoscaCircleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: '500000' }) contributionAmount!: string;
  @ApiProperty() frequency!: CycleFrequency;
  @ApiProperty() durationCycles!: number;
  @ApiProperty() filledSlots!: number;
  @ApiProperty() maxSlots!: number;
  @ApiProperty({ enum: CircleStatus }) status!: CircleStatus;
  @ApiProperty({
    enum: PayoutLogic,
    description:
      'RANDOM_DRAW = shuffled at activation; ' +
      'SEQUENTIAL = first-joined first; ' +
      'TRUST_SCORE = highest ATI first; ' +
      'ADMIN_ASSIGNED = manual order set by admin; ' +
      'COMBINED = trust score then join date',
  })
  payoutLogic!: PayoutLogic;
  @ApiProperty({
    example: '2026-05-01T10:00:00Z',
    description: 'The deadline for the first contribution. Payout occurs 24 hours after this.',
    type: String,
    required: false,
  })
  initialContributionDeadline?: Date | null;
  @ApiProperty({ example: 10, description: 'Fixed platform collateral rate (%)' }) collateralPercentage!: number;
  @ApiProperty({ type: AdminResponseDto })
  admin!: AdminResponseDto;
  @ApiProperty({ isArray: true, description: 'List of members in the circle' })
  members!: any[];
}

export class RoscaMembershipResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() circleId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: MembershipStatus }) status!: MembershipStatus;
  @ApiProperty({ example: '100000' }) collateralAmount!: string;
  @ApiProperty() completedCycles!: number;
  @ApiProperty() totalLatePayments!: number;
  @ApiProperty() totalPenaltiesPaid!: string;
}

export class RoscaCycleScheduleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() circleId!: string;
  @ApiProperty() cycleNumber!: number;
  @ApiProperty() contributionDeadline!: Date;
  @ApiProperty() payoutDate!: Date;
  @ApiProperty({ required: false }) recipientId?: string | null;
  @ApiProperty({ enum: ScheduleStatus }) status!: ScheduleStatus;
}

export class MemberPositionAssignmentDto {
  @ApiProperty({ description: 'User ID of the member' })
  @IsString()
  userId!: string;

  @ApiProperty({ description: 'Payout position (1 = first to receive, N = last)', minimum: 1 })
  @IsInt()
  @Min(1)
  position!: number;
}

export class UpdatePayoutConfigDto {
  @ApiPropertyOptional({
    enum: PayoutLogic,
    description:
      'Payout ordering strategy. ' +
      'RANDOM_DRAW = shuffled at activation; ' +
      'SEQUENTIAL = order of joining; ' +
      'TRUST_SCORE = highest ATI score first; ' +
      'ADMIN_ASSIGNED = positions set manually via `assignments`; ' +
      'COMBINED = trust score then join date',
  })
  @IsOptional()
  @IsEnum(PayoutLogic)
  payoutLogic?: PayoutLogic;

  @ApiPropertyOptional({
    type: [MemberPositionAssignmentDto],
    description:
      'Required when payoutLogic is ADMIN_ASSIGNED. ' +
      'Each entry maps a member userId to their payout position. ' +
      'Positions must be unique integers starting from 1. ' +
      'All active members must be assigned before the circle can be activated.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberPositionAssignmentDto)
  assignments?: MemberPositionAssignmentDto[];
}

// ── Payout Assignments (read) ───────────────────

export class PayoutAssignmentItemDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, description: 'null if not yet assigned' }) position!: number | null;
}

export class PayoutConfigResponseDto {
  @ApiProperty({ enum: PayoutLogic }) payoutLogic!: PayoutLogic;
  @ApiProperty({ description: 'Whether all active members have been assigned a position' })
  allAssigned!: boolean;
  @ApiProperty({ type: [PayoutAssignmentItemDto] }) assignments!: PayoutAssignmentItemDto[];
}

// ── My Pending Join Requests ────────────────────

export class PendingJoinRequestCircleSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '500000' }) contributionAmount!: string;
  @ApiProperty() frequency!: string;
  @ApiProperty() maxSlots!: number;
  @ApiProperty() filledSlots!: number;
  @ApiProperty() status!: string;
}

export class MyPendingJoinRequestDto {
  @ApiProperty() membershipId!: string;
  @ApiProperty() circleId!: string;
  @ApiProperty({ example: '50000' }) collateralReserved!: string;
  @ApiProperty({ nullable: true }) requestedAt!: Date | null;
  @ApiProperty({ type: PendingJoinRequestCircleSummaryDto }) circle!: PendingJoinRequestCircleSummaryDto;
}

// ── Dashboard ──────────────────────────────────

export class DashboardNextDeadlineDto {
  @ApiProperty({ example: 'January Savers' })
  groupName!: string;

  @ApiProperty({ example: '2026-05-01T10:00:00.000Z' })
  deadline!: Date;
}

export class DashboardPendingBreakdownDto {
  @ApiProperty({ example: 'January Savers' })
  groupName!: string;

  @ApiProperty({ example: 3 })
  pendingCount!: number;
}

export class DashboardPendingRequestsDto {
  @ApiProperty({ example: 7 })
  total!: number;

  @ApiProperty({ type: [DashboardPendingBreakdownDto] })
  breakdown!: DashboardPendingBreakdownDto[];
}

export class AdminDashboardResponseDto {
  @ApiProperty({ example: 4 })
  totalGroups!: number;

  @ApiProperty({ type: DashboardNextDeadlineDto, nullable: true })
  nextDeadline!: DashboardNextDeadlineDto | null;

  @ApiProperty({ type: DashboardPendingRequestsDto })
  pendingJoinRequests!: DashboardPendingRequestsDto;
}

// ── Join Request Management ─────────────────────

export class PendingCircleOverviewDto {
  @ApiProperty()
  circleId!: string;

  @ApiProperty({ example: 'January Savers' })
  name!: string;

  @ApiProperty({ example: 3 })
  pendingCount!: number;

  @ApiProperty({ example: '2026-04-01T08:00:00.000Z', nullable: true })
  oldestRequestAt!: Date | null;
}

export class JoinRequesterDossierDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  membershipId!: string;

  @ApiProperty({ example: 'John Doe' })
  name!: string;

  @ApiProperty({ example: '2026-04-01T08:00:00.000Z' })
  requestedAt!: Date;

  @ApiProperty({ example: 658, description: 'ATI display score (300–850)' })
  trustScore!: number;

  @ApiProperty({
    example: 87,
    nullable: true,
    description: 'Percentage of payments made on time. Null if user has no payment history yet.',
  })
  onTimePaymentRate!: number | null;

  @ApiProperty({ example: 4, description: 'Number of ROSCA cycles completed across all groups' })
  completedCycles!: number;
}

// ── Invite ─────────────────────────────────────

export class CreateInviteDto {
  @ApiProperty({ example: 'jane@example.com', description: 'Email address of the person to invite' })
  @IsString()
  @IsNotEmpty()
  email!: string;
}

export class JoinByInviteDto {
  @ApiProperty({ description: 'Invite token from the invite link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class InviteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() circleId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() token!: string;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty({ nullable: true }) usedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

// ── Round query ────────────────────────────────

export class RoundQueryDto {
  @ApiPropertyOptional({ example: 2, description: 'Cycle number to filter by. Defaults to currentCycle.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  round?: number;
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
  @ApiProperty({ example: '3500000', description: 'contributionAmount × filledSlots' }) expectedPot!: string;
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

// ────────────────────────────────────────────────
// FORMATTERS
// ────────────────────────────────────────────────

export function formatCircleResponse(circle: any): RoscaCircleResponseDto {
  return {
    id: circle.id,
    name: circle.name,
    description: circle.description,
    contributionAmount: circle.contributionAmount.toString(),
    frequency: circle.frequency,
    durationCycles: circle.durationCycles,
    filledSlots: circle.filledSlots,
    maxSlots: circle.maxSlots,
    status: circle.status,
    payoutLogic: circle.payoutLogic,
    initialContributionDeadline: circle.initialContributionDeadline,
    collateralPercentage: circle.collateralPercentage,
    admin: {
      firstName: circle.admin.firstName,
      lastName: circle.admin.lastName,
      email: circle.admin.email,
    },
    members:
      circle.memberships?.map((m: any) => ({
        userId: m.userId,
        name: `${m.user.firstName} ${m.user.lastName}`,
        status: m.status,
        position: m.payoutPosition,
        joinedAt: m.joinedAt,
        trustScore: m.user.userTrustStats
          ? Math.round(300 + m.user.userTrustStats.trustScore * 5.5)
          : 575,
      })) || [],
  };
}

export function formatMembershipResponse(membership: any): RoscaMembershipResponseDto {
  return {
    id: membership.id,
    circleId: membership.circleId,
    userId: membership.userId,
    status: membership.status,
    collateralAmount: membership.collateralAmount.toString(),
    completedCycles: membership.completedCycles,
    totalLatePayments: membership.totalLatePayments,
    totalPenaltiesPaid: (membership.totalPenaltiesPaid ?? 0).toString(),
  };
}

export function formatScheduleResponse(schedule: any): RoscaCycleScheduleResponseDto {
  return {
    id: schedule.id,
    circleId: schedule.circleId,
    cycleNumber: schedule.cycleNumber,
    contributionDeadline: schedule.contributionDeadline,
    payoutDate: schedule.payoutDate,
    recipientId: schedule.recipientId,
    status: schedule.status,
  };
}
