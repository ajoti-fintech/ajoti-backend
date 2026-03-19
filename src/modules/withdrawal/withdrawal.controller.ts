import {
    Controller,
    Post,
    Body,
    UseGuards,
    Request,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { WithdrawalService } from './withdrawal.service';
import { InitializeWithdrawalDto } from './dto/withdrawal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';


@Controller('wallet/withdrawal')
@UseGuards(JwtAuthGuard)
export class WithdrawalController {
    constructor(private readonly withdrawalService: WithdrawalService) { }

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
        @Request() req: { user: { id: string } },
        @Body() dto: InitializeWithdrawalDto,
    ) {
        return this.withdrawalService.initializeWithdrawal(req.user.id, dto);
    }
}