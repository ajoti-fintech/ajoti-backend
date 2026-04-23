import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class DeleteUserAccountDto {
  @ApiProperty({
    example: 'CorrectHorseBatteryStaple123!',
    description: 'Current account password for confirmation.',
  })
  @IsString()
  @MinLength(8)
  currentPassword: string;

  @ApiProperty({
    example: 'DELETE',
    description: 'Safety confirmation phrase.',
  })
  @IsString()
  @IsNotEmpty()
  confirm: string;

  @ApiPropertyOptional({
    example: 'No longer using this product',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

