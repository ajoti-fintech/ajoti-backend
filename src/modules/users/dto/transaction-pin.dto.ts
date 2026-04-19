import { IsNumberString, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetTransactionPinDto {
  @ApiProperty({ example: '1234', description: '4-digit transaction PIN' })
  @IsNumberString()
  @Length(4, 4)
  pin: string;

  @ApiPropertyOptional({ example: '0000', description: 'Current PIN — required when changing an existing PIN' })
  @IsOptional()
  @IsString()
  currentPin?: string;
}
