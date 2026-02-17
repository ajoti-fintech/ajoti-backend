import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, IsPositive } from 'class-validator';

export class ReversePayoutDto {
  @ApiProperty({ description: 'The ID of the payout record to reverse' })
  @IsUUID()
  @IsNotEmpty()
  originalPayoutId!: string;

  @ApiProperty({ description: 'The recipient user ID' })
  @IsUUID()
  @IsNotEmpty()
  recipientId!: string;

  @ApiProperty({ description: 'The ID of the schedule cycle' })
  @IsUUID()
  @IsNotEmpty()
  scheduleId!: string;

  @ApiProperty({ example: '50000', description: 'Amount in kobo' })
  @IsNotEmpty()
  // We use string here to handle BigInt conversion safely from JSON
  amount!: string;

  @ApiProperty({ example: 'Bank transfer failed: Account invalid' })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
