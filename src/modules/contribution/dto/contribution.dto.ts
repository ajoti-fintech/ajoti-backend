import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class ListContributionsQueryDto {
  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cycleNumber?: number;

  @ApiProperty({ required: false, example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({ required: false, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class CreateContributionDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  cycleNumber!: number;
}

export class RoscaContributionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() cycleNumber!: number;
  @ApiProperty() amount!: string;
  @ApiProperty() penaltyAmount!: string;
  @ApiProperty() transactionReference!: string;
  @ApiProperty() paidAt!: Date;
}

export function formatContributionResponse(contribution: any): RoscaContributionResponseDto {
  return {
    id: contribution.id,
    cycleNumber: contribution.cycleNumber,
    amount: contribution.amount.toString(),
    penaltyAmount: (contribution.penaltyAmount ?? 0n).toString(),
    transactionReference: contribution.transactionReference,
    paidAt: contribution.paidAt || contribution.createdAt,
  };
}
