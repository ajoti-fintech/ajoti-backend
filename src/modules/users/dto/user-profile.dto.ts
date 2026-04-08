import { ApiProperty } from '@nestjs/swagger';
import { Role, WalletStatus } from '@prisma/client';

class WalletSummaryDto {
  @ApiProperty({ example: '150000', description: 'Available balance in kobo/sub-units' })
  balance: string;

  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty({ enum: WalletStatus, example: WalletStatus.ACTIVE })
  status: WalletStatus;
}

class VirtualAccountSummaryDto {
  @ApiProperty({ example: '0123456789' })
  accountNumber: string;

  @ApiProperty({ example: 'Wema Bank (Ajoti/SafeHaven)' })
  bankName: string;
}

export class UserProfileResponseDto {
  @ApiProperty({ example: 'u-uuid-123' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'Iseoluwa' })
  firstName: string;

  @ApiProperty({ example: 'Afolayan' })
  lastName: string;

  @ApiProperty({ example: '08012345678' })
  phone: string;

  @ApiProperty({ example: true })
  isVerified: boolean;

  @ApiProperty({ enum: Role, example: Role.MEMBER })
  role: Role;

  @ApiProperty({ example: '2026-04-06T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ type: WalletSummaryDto, nullable: true })
  wallet: WalletSummaryDto | null;

  @ApiProperty({ type: VirtualAccountSummaryDto, nullable: true })
  virtualAccount: VirtualAccountSummaryDto | null;
}
