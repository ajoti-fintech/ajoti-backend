import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class VerifyNinDto {
  @ApiProperty({ example: '23456789012' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'NIN must be exactly 11 digits' })
  nin: string;
}

export class VerifyBvnDto {
  @ApiProperty({ example: '23456789012' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'NIN must be exactly 11 digits' })
  bvn: string;
}

export class SubmitNextOfKinDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  nextOfKinName: string;

  @ApiProperty({ example: 'Brother' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  nextOfKinRelationship: string;
}

export class ReviewKycDto {
  @IsString()
  status: 'APPROVED' | 'REJECTED';

  @IsString()
  rejectionReason?: string;
}
