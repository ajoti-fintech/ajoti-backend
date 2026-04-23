import { IsString, IsNotEmpty, Length, Matches } from 'class-validator';

export class VerifyBankAccountDto {
    @IsString()
    @IsNotEmpty()
    @Length(3, 10)
    bankCode: string;

    @IsString()
    @IsNotEmpty()
    @Length(10, 10)
    @Matches(/^\d{10}$/, { message: 'accountNumber must be exactly 10 digits' })
    accountNumber: string;
}

export class BankDto {
    id: number;
    code: string;
    name: string;
}

export class BankListResponseDto {
    banks: BankDto[];
}

export class AccountVerifyResponseDto {
    accountNumber: string;
    accountName: string;
}