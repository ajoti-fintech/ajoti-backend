// src/modules/rosca/dto/rosca.dto.ts
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
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

  @ApiProperty({ example: 10, description: 'Collateral %' })
  @IsNumber()
  @Min(0)
  @Max(100)
  collateralPercentage!: number;

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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  latePenaltyPercent?: number;
}

export class ActivateCircleDto {
  @ApiProperty({ example: '2026-03-01T00:00:00Z' })
  @IsDateString()
  @IsNotEmpty()
  startDate!: string;
}

export class ListCirclesQueryDto {
  @IsOptional()
  @IsEnum(CircleStatus)
  status?: CircleStatus;

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

  @ApiPropertyOptional({ example: '2026-06-01T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: 5.0, description: 'Collateral %' })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  collateralPercentage?: number;

  @ApiPropertyOptional({ enum: PayoutLogic })
  @IsEnum(PayoutLogic)
  @IsOptional()
  payoutLogic?: PayoutLogic;
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
  firstName: string;

  @ApiProperty({ example: 'Maxim' })
  lastName: string;

  @ApiProperty({ example: 'admin@ajoti.com' })
  email: string;
}

export class RoscaCircleResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '500000' }) contributionAmount!: string;
  @ApiProperty() frequency!: CycleFrequency;
  @ApiProperty() durationCycles!: number;
  @ApiProperty() filledSlots!: number;
  @ApiProperty() maxSlots!: number;
  @ApiProperty({ enum: CircleStatus }) status!: CircleStatus;
  @ApiProperty({
    example: '2026-05-01T10:00:00Z',
    description: 'The start date of the ROSCA circle',
    type: String,
    required: false,
  })
  startDate?: Date | null;
  @ApiProperty() collateralPercentage!: number;
  @ApiProperty({ type: AdminResponseDto })
  admin!: AdminResponseDto;
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

// ────────────────────────────────────────────────
// FORMATTERS
// ────────────────────────────────────────────────

export function formatCircleResponse(circle: any): RoscaCircleResponseDto {
  return {
    id: circle.id,
    name: circle.name,
    contributionAmount: circle.contributionAmount.toString(),
    frequency: circle.frequency,
    durationCycles: circle.durationCycles,
    filledSlots: circle.filledSlots,
    maxSlots: circle.maxSlots,
    status: circle.status,
    startDate: circle.startDate,
    collateralPercentage: circle.collateralPercentage,
    admin: {
      firstName: circle.admin.firstName,
      lastName: circle.admin.lastName,
      email: circle.admin.email,
    },
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
