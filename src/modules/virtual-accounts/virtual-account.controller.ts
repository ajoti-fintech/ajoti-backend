import { Controller, Get, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VirtualAccountService } from "./virtual-account.service";
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import {  
    VirtualAccountResponseDto,
    formatVirtualAccountResponse,
} from "./dto/virtual-account.dto";

@ApiTags('Wallet')
@Controller('wallet/virtual-account')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class VirtualAccountController {
    constructor(private readonly vaService: VirtualAccountService) { }

    /**
     * GET /api/wallet/virtual-account
     *
     * Returns the user's dedicated NGN virtual account details.
     * If one doesn't exist yet it is provisioned on the fly (idempotent).
     *
     * The returned account number (Wema Bank) can receive transfers from any
     * Nigerian bank. Flutterwave fires a charge.completed webhook when money
     * arrives, which credits the user's wallet ledger automatically.
     */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Get (or create) your dedicated NGN virtual account',
        description:
            'Returns your Wema Bank virtual account details. ' +
            'Send money to this account from any Nigerian bank to fund your wallet. ' +
            'Funds reflect automatically once Flutterwave confirms receipt.',
    })
    @ApiResponse({ status: 200, type: VirtualAccountResponseDto })
    @ApiResponse({ status: 400, description: 'KYC incomplete (live mode only)' })
    async getVirtualAccount(@CurrentUser('userId') userId: string) {
        const va = await this.vaService.getOrCreate(userId);
        return {
            success: true,
            message: 'Virtual account retrieved successfully',
            data: formatVirtualAccountResponse(va),
        };
    }
}