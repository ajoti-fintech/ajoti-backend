import { ApiProperty } from '@nestjs/swagger';

export class VirtualAccountResponseDto {
    @ApiProperty({ example: 'uuid-here' })
    id: string;

    @ApiProperty({ example: '9880000000', description: 'Bank account number to receive transfers' })
    accountNumber: string;

    @ApiProperty({ example: 'WEMA BANK' })
    bankName: string;

    @ApiProperty({ example: 'Ajoti Wallet - Jane Doe' })
    accountName: string;

    @ApiProperty({ example: 'NGN' })
    currency: string;

    @ApiProperty({ example: true })
    isActive: boolean;

    @ApiProperty({ example: true })
    isPermanent: boolean;

    @ApiProperty()
    createdAt: Date;
}

export function formatVirtualAccountResponse(va: any): VirtualAccountResponseDto {
    return {
        id: va.id,
        accountNumber: va.accountNumber,
        bankName: va.bankName,
        accountName: va.accountName,
        currency: va.currency,
        isActive: va.isActive,
        isPermanent: va.isPermanent,
        createdAt: va.createdAt,
    };
}