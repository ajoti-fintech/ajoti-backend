// src/modules/rosca/dto/membership.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { MembershipStatus } from '@prisma/client';

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
  @ApiProperty({ type: PendingJoinRequestCircleSummaryDto })
  circle!: PendingJoinRequestCircleSummaryDto;
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
