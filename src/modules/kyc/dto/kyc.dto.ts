import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches, MinLength } from 'class-validator';

export class VerifyNinDto {
  @ApiProperty({ example: '23456789012' })
  @IsNotEmpty()
  @IsString()
  @Length(11, 11, { message: 'NIN must be exactly 11 characters' })
  @Matches(/^\d{11}$/, { message: 'NIN contain digits' })
  nin: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  lastName: string;

  @ApiProperty({ example: '2000-01-01' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date of birth must be in YYYY-MM-DD format' })
  dob: string;

  @ApiProperty({ example: '+23456789012' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  // @Matches(/^\+?\d{10,15}$/, { message: 'Phone number must be valid' })
  phoneNumber: string;
}

export class VerifyBvnDto {
  @ApiProperty({ example: '23456789012' })
  @IsNotEmpty()
  @IsString()
  @Length(11, 11, { message: 'BVN must be exactly 11 characters' })
  @Matches(/^\d{11}$/, { message: 'BVN must contain only digits' })
  bvn: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  lastName: string;

  @ApiProperty({ example: '2000-01-01' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date of birth must be in YYYY-MM-DD format' })
  dob: string;

  @ApiProperty({ example: '+23456789012' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phoneNumber: string;
}

export class VerifyNokDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 255)
  nextOfKinName: string;

  @ApiProperty({ example: 'Brother' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  nextOfKinRelationship: string;

  @ApiProperty({ example: '+23456789012' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  // @Matches(/^\+?\d{10,15}$/, { message: 'Phone number must be valid' })
  nextOfKinPhone: string;
}

export class ReviewKycDto {
  @IsString()
  status: 'APPROVED' | 'REJECTED';

  @IsString()
  rejectionReason?: string;
}

export class KycResponseDto {
  id: string;
  userId: string;
  status: string;
  step: string;
  nin?: string;
  bvn?: string;
  nextOfKinName?: string;
  nextOfKinRelationship?: string;
  ninVerifiedAt?: Date;
  bvnVerifiedAt?: Date;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
