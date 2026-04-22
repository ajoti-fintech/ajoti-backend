// src/modules/rosca/dto/circle.dto.ts
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
  CycleFrequency,
  PayoutLogic,
  ScheduleStatus,
  CircleVisibility,
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
  @ApiProperty({ example: 10, description: 'Fixed platform collateral rate (%)' })
  collateralPercentage!: number;
  @ApiProperty({ type: AdminResponseDto })
  admin!: AdminResponseDto;
  @ApiProperty({ isArray: true, description: 'List of members in the circle' })
  members!: any[];
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

export class PayoutAssignmentItemDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, description: 'null if not yet assigned' })
  position!: number | null;
}

export class PayoutConfigResponseDto {
  @ApiProperty({ enum: PayoutLogic }) payoutLogic!: PayoutLogic;
  @ApiProperty({ description: 'Whether all active members have been assigned a position' })
  allAssigned!: boolean;
  @ApiProperty({ type: [PayoutAssignmentItemDto] }) assignments!: PayoutAssignmentItemDto[];
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
          ? Math.round(m.user.userTrustStats.trustScore)
          : 50,
      })) || [],
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
