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
  members!: any[]; // You can create a MemberResponseDto later for more strictness
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
  @IsString()
  userId!: string;

  @IsInt()
  position!: number;
}

export class UpdatePayoutConfigDto {
  @IsOptional()
  @IsEnum(PayoutLogic)
  payoutLogic?: PayoutLogic;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MemberPositionAssignmentDto)
  assignments?: MemberPositionAssignmentDto[];
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

// ────────────────────────────────────────────────
// FORMATTERS
// ────────────────────────────────────────────────

export function formatCircleResponse(circle: any): RoscaCircleResponseDto {
  return {
    id: circle.id,
    name: circle.name,
    description: circle.description, // Added if you have it in your DTO
    contributionAmount: circle.contributionAmount.toString(),
    frequency: circle.frequency,
    durationCycles: circle.durationCycles,
    filledSlots: circle.filledSlots,
    maxSlots: circle.maxSlots,
    status: circle.status,
    initialContributionDeadline: circle.initialContributionDeadline,
    collateralPercentage: circle.collateralPercentage,

    // Formatted Admin Object
    admin: {
      firstName: circle.admin.firstName,
      lastName: circle.admin.lastName,
      email: circle.admin.email,
    },
    // NEW: Map memberships to a clean members array
    members:
      circle.memberships?.map((m: any) => ({
        userId: m.userId,
        name: `${m.user.firstName} ${m.user.lastName}`,
        status: m.status,
        position: m.payoutPosition,
        joinedAt: m.joinedAt,
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
