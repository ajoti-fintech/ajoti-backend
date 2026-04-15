import {
    IsString,
    IsNumber,
    IsPositive,
    IsNotEmpty,
    IsOptional,
    Length,
    Matches,
    IsNumberString,
} from 'class-validator';

export class InitializeWithdrawalDto {
    /**
     * Amount in KOBO (smallest NGN unit).
     * Min: 10000 kobo = NGN 100
     * Max: enforced by wallet available balance
     */
    @IsNumber()
    @IsPositive()
    amount: number; // kobo

    /** Nigerian bank code (e.g. "044" for Access Bank) */
    @IsString()
    @IsNotEmpty()
    @Length(3, 10)
    bankCode: string;

    /** Destination account number */
    @IsString()
    @IsNotEmpty()
    @Length(10, 10)
    @Matches(/^\d{10}$/, { message: 'accountNumber must be exactly 10 digits' })
    accountNumber: string;

    /** Account holder name — caller should verify first via /bank/verify */
    @IsString()
    @IsNotEmpty()
    accountName: string;

    /** Bank display name (e.g. "Access Bank") */
    @IsString()
    @IsNotEmpty()
    bankName: string;

    /** Optional narration shown on recipient's statement */
    @IsOptional()
    @IsString()
    narration?: string;

    /** 4-digit transaction PIN */
    @IsNumberString()
    @Length(4, 4)
    transactionPin: string;
}

export class WithdrawalResponseDto {
    reference: string;   // Internal WITHDRAWAL-{uuid}
    amount: number;      // Kobo
    status: string;
    message: string;
}