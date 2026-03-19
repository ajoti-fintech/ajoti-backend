import { ApiProperty } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  Matches,
  Length,
  IsDateString,
  IsIn,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'John' })
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9]+$/, { message: 'First name can only contain letters' })
  readonly firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9]+$/, { message: 'Last name can only contain letters' })
  readonly lastName: string;

  @ApiProperty({ example: 'johndoe@example.com' })
  @IsNotEmpty()
  @IsEmail()
  readonly email: string;

  @ApiProperty({ example: '1990-01-01' })
  @IsNotEmpty()
  @IsDateString({}, { message: 'dob must be in YYYY-MM-DD format' })
  readonly dob: string;

  @ApiProperty({ example: 'MALE', enum: ['MALE', 'FEMALE'] })
  @IsNotEmpty()
  readonly gender: Gender;

  @ApiProperty({ example: '+1234567890' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+\d{10,15}$/, {
    message: 'Phone number must be in international format starting with +',
  })
  readonly phone: string;

  @ApiProperty({ example: 'password' })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  // @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, { message: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character" })
  @IsNotEmpty()
  readonly password: string;
}

export class OAuthPasswordFormDto {
  @ApiProperty({ example: 'password', enum: ['password'] })
  @IsString()
  @IsIn(['password'])
  grant_type: 'password';

  @ApiProperty({ example: 'johndoe@example.com' })
  @IsNotEmpty()
  @IsEmail()
  readonly email: string;

  @ApiProperty({ example: 'password' })
  @IsNotEmpty()
  @IsString()
  readonly password: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  scope?: string;
}

export class LogoutDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  readonly refreshToken: string;
}

export class ResentOtpDto {
  @ApiProperty({ example: 'johndoe@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'johndoe@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'johndoe@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;

  @ApiProperty({ example: 'password' })
  @IsNotEmpty()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(20)
  newPassword: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'password' })
  @IsNotEmpty()
  @IsString()
  oldPassword: string;

  @ApiProperty({ example: 'password' })
  @IsNotEmpty()
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(20)
  newPassword: string;
}

export class VerifyEmailDto {
  @ApiProperty({ example: 'johndoe@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456' })
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  otp: string;
}

export class RefreshTokenDto {
  readonly refreshToken: string;
}

export class RegistrationSuccessfulDto {
  @ApiProperty({ example: 'successful' })
  readonly message: string;
  @ApiProperty()
  readonly userId: string;
}

export class VerifyEmailResponse {
  @ApiProperty({ example: 'successful' })
  readonly message: string;
}
