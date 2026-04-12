// src/modules/rosca/dto/invite.dto.ts
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInviteDto {
  @ApiProperty({
    example: 'jane@example.com',
    description: 'Email address of the person to invite',
  })
  @IsString()
  @IsNotEmpty()
  email!: string;
}

export class JoinByInviteDto {
  @ApiProperty({ description: 'Invite token from the invite link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class InviteResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() circleId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() token!: string;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty({ nullable: true }) usedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
