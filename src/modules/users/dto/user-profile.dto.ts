import { ApiProperty } from '@nestjs/swagger';

export class UserProfileResponseDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'Iseoluwa' })
  firstName: string;

  @ApiProperty({ example: 'Afolayan' })
  lastName: string;

  @ApiProperty({ example: '1990-01-01' })
  dob: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ example: 'MEMBER', enum: ['MEMBER', 'ADMIN', 'SUPERADMIN'] })
  role: string;

  @ApiProperty({ example: null, nullable: true })
  adminRequestedAt: string | null;
}
