import {
    Controller,
    Get,
    Post,
    Delete,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
} from '@nestjs/swagger';
import { VirtualAccountService } from "./virtual-account.service";
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
     * The returned account number can receive transfers from any
     * Nigerian bank. Flutterwave fires a charge.completed webhook when money
     * arrives, which credits the user's wallet ledger automatically.
     */
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Get (or create) your dedicated NGN virtual account',
        description:
            'Returns your virtual account details. ' +
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

    /**
     * POST /api/wallet/virtual-account
     *
     * Explicit static VA provisioning endpoint (idempotent).
     * If a VA already exists for the user, the existing one is returned.
     */
    @Post()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Create your static NGN virtual account (idempotent)',
        description:
            'Creates a permanent virtual account for wallet funding. ' +
            'If you already have one, the existing account is returned.',
    })
    @ApiResponse({ status: 200, type: VirtualAccountResponseDto })
    @ApiResponse({ status: 400, description: 'KYC incomplete (live mode only)' })
    async createVirtualAccount(@CurrentUser('userId') userId: string) {
        const va = await this.vaService.getOrCreate(userId);
        return {
            success: true,
            message: 'Virtual account Created successfully',
            data: formatVirtualAccountResponse(va),
        };
    }

    @Delete()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: 'Delete your virtual account',
        description: 'Deletes your virtual account from Flutterwave and removes the local mapping.',
    })
    async deleteVirtualAccount(@CurrentUser('userId') userId: string) {
        const result = await this.vaService.deleteForUser(userId);
        return {
            success: true,
            message: 'Virtual account deleted successfully',
            data: result,
        };
    }
}

/*
// Commented out for now per product decision.
// Keep this block for future admin VA management needs.
@ApiTags('Wallet Admin')
@Controller('admin/virtual-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
@ApiBearerAuth('access-token')
export class VirtualAccountAdminController {
    constructor(private readonly vaService: VirtualAccountService) { }

    @Get(':orderRef')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary: '[Admin] Get virtual account details by order_ref',
    })
    async getVirtualAccountByOrderRef(@Param('orderRef') orderRef: string) {
        const response = await this.vaService.getProviderVirtualAccountByOrderRef(orderRef);
        return {
            success: true,
            message: 'Virtual account details retrieved successfully',
            data: response,
        };
    }
}
*/
