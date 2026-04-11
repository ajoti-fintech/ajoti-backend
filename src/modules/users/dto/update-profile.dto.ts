import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateMyProfileDto {
  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'Iseoluwa' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9]+$/, { message: 'First name can only contain letters' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Afolayan' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9]+$/, { message: 'Last name can only contain letters' })
  lastName?: string;

  @ApiPropertyOptional({ example: '1990-01-01' })
  @IsOptional()
  @IsDateString({}, { message: 'dob must be in YYYY-MM-DD format' })
  dob?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  @IsString()
  @Matches(/^\+\d{10,15}$/, {
    message: 'Phone number must be in international format starting with +',
  })
  phone?: string;

  @ApiPropertyOptional({ example: 'StrongerPassword123' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  newPassword?: string;

  @ApiPropertyOptional({ example: 'CurrentPassword123' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  currentPassword?: string;
}

export class VerifyPendingEmailChangeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Length(6, 6)
  otp: string;
}
