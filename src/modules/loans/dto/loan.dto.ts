import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { LoanStatus } from '@prisma/client';

// ── Request DTOs ──────────────────────────────────────────────────────────────

export class ApplyLoanDto {
  @ApiProperty({ example: 'uuid', description: 'ID of the ROSCA circle to take a loan against' })
  @IsUUID()
  @IsNotEmpty()
  circleId!: string;
}

export class LoanEligibilityQueryDto {
  @ApiProperty({ example: 'uuid', description: 'ID of the ROSCA circle' })
  @IsUUID()
  @IsNotEmpty()
  @IsString()
  circleId!: string;
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

export class LoanEligibilityResponseDto {
  @ApiProperty() eligible!: boolean;
  @ApiProperty() finalCreditScore!: number;
  @ApiProperty() allowedPercent!: number;
  @ApiProperty({ example: '500000' }) expectedPayoutAmount!: string; // kobo as string
  @ApiProperty({ example: '250000' }) maxLoanAmount!: string;        // kobo as string
  @ApiProperty({ required: false }) ineligibilityReason?: string;
}

export class LoanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() circleId!: string;
  @ApiProperty({ example: '500000' }) payoutAmount!: string;
  @ApiProperty({ example: '250000' }) loanAmount!: string;
  @ApiProperty({ example: '50000' }) companyFee!: string;
  @ApiProperty({ example: '200000' }) finalPayout!: string;
  @ApiProperty() creditScoreUsed!: number;
  @ApiProperty() allowedPercent!: number;
  @ApiProperty({ enum: LoanStatus }) status!: LoanStatus;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ required: false }) repaidAt?: Date | null;
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatLoanResponse(loan: any): LoanResponseDto {
  return {
    id: loan.id,
    userId: loan.userId,
    circleId: loan.circleId,
    payoutAmount: loan.payoutAmount.toString(),
    loanAmount: loan.loanAmount.toString(),
    companyFee: loan.companyFee.toString(),
    finalPayout: loan.finalPayout.toString(),
    creditScoreUsed: loan.creditScoreUsed,
    allowedPercent: loan.allowedPercent,
    status: loan.status,
    createdAt: loan.createdAt,
    repaidAt: loan.repaidAt ?? null,
  };
}
