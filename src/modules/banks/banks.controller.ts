import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { BanksService } from './banks.service';
import { VerifyBankAccountDto } from './banks.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class BanksController {
    constructor(private readonly banksService: BanksService) { }

    /**
     * GET /api/wallet/banks
     * Returns all supported Nigerian banks.
     * Cached for 6 hours — proxied from Flutterwave.
     */
    @Get('banks')
    async getBanks() {
        return this.banksService.getBanks();
    }

    /**
     * POST /api/wallet/bank/verify
     * Resolve account name before initiating a withdrawal.
     * Should always be called by the frontend before showing the confirm screen.
     */
    @Post('bank/verify')
    @HttpCode(HttpStatus.OK)
    async verifyAccount(@Body() dto: VerifyBankAccountDto) {
        return this.banksService.verifyBankAccount(dto);
    }
}