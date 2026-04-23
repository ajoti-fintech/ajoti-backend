import {
    Controller,
    Post,
    Get,
    Body,
    UseGuards,
    Request,
    HttpCode,
    HttpStatus,
    BadRequestException,
} from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';
import { InitializeWithdrawalDto } from './dto/withdrawal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FlutterwaveProvider } from '../flutterwave/flutterwave.provider';


@Controller('wallet/withdrawal')
@UseGuards(JwtAuthGuard)
export class WithdrawalController {
    constructor(
        private readonly withdrawalService: WithdrawalService,
        private readonly flw: FlutterwaveProvider,
    ) { }

    @Get('banks')
    @HttpCode(HttpStatus.OK)
    async getBanks() {
        const res = await this.flw.getBanks('NG');
        return { success: true, data: res.data };
    }

    @Post('resolve-account')
    @HttpCode(HttpStatus.OK)
    async resolveAccount(@Body() body: { accountNumber: string; bankCode: string }) {
        if (!body.accountNumber || !body.bankCode) {
            throw new BadRequestException('accountNumber and bankCode are required');
        }
        const res = await this.flw.resolveAccountName(body.accountNumber, body.bankCode);
        if (res.status !== 'success' || !res.data) {
            throw new BadRequestException(res.message ?? 'Could not resolve account');
        }
        return { success: true, data: res.data };
    }

    /**
     * POST /api/wallet/withdrawal/initialize
     *
     * Step 1 of withdrawal flow:
     * - Validates wallet status and balance
     * - Atomically debits the ledger
     * - Calls Flutterwave Transfer API
     * - Returns internal reference
     *
     * Step 2 is handled by the webhook: POST /api/webhooks/flutterwave
     * Webhook confirms success (mark SUCCESS) or failure (create REVERSAL credit).
     */
    @Post('initialize')
    @HttpCode(HttpStatus.CREATED)
    async initialize(
        @Request() req: { user: { userId: string } },
        @Body() dto: InitializeWithdrawalDto,
    ) {
        return this.withdrawalService.initializeWithdrawal(req.user.userId, dto);
    }
}
