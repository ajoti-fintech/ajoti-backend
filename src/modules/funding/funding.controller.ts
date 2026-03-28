// src/modules/funding/funding.controller.ts
import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { FundingService } from './funding.service';
import { InitializeFundingDto, FundingResponseDto } from './dto/funding.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('Wallet Funding')
@ApiBearerAuth('access-token')
@Controller('wallet/funding')
@UseGuards(JwtAuthGuard)
export class FundingController {
  constructor(private readonly fundingService: FundingService) {}

  @Post('initialize')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initialize a funding transaction and get payment link' })
  @ApiBody({ type: InitializeFundingDto })
  @ApiResponse({ status: 201, description: 'Funding session created', type: FundingResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid input or wallet inactive' })
  async initialize(
    @CurrentUser('userId') userId: string,
    @Body() dto: InitializeFundingDto,
  ): Promise<FundingResponseDto> {
    const result = await this.fundingService.initialize(userId, dto);

    return {
      success: true,
      message: 'Funding initialized successfully',
      data: result,
    };
  }

  @Get('methods')
  @ApiOperation({ summary: 'Get list of available funding methods' })
  @ApiResponse({ status: 200, description: 'List of funding methods' })
  async getFundingMethods() {
    const methods = await this.fundingService.getFundingMethods();

    return {
      success: true,
      data: { methods },
    };
  }
}

@ApiTags('Wallet Funding Admin')
@ApiBearerAuth('access-token')
@Controller('admin/funding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
export class FundingAdminController {
  constructor(private readonly fundingService: FundingService) {}

  @Post('reconcile/:reference')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Super Admin: manually reconcile one funding transaction by internal reference',
  })
  @ApiParam({
    name: 'reference',
    required: true,
    example: 'AJT-FUND-8ca2de2e-67c8-4d51-b74d-c1b6f5939b55',
    description: 'Internal funding tx_ref created at initialize step',
  })
  @ApiResponse({ status: 200, description: 'Manual reconciliation executed' })
  @ApiResponse({ status: 400, description: 'Invalid reference' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({ status: 403, description: 'Only SUPERADMIN can access this endpoint' })
  async manualReconcile(
    @Param('reference') reference: string,
    @CurrentUser('userId') superAdminId: string,
  ) {
    const result = await this.fundingService.manualReconcileByReference(
      reference,
      superAdminId,
    );

    return {
      success: true,
      message: 'Manual funding reconciliation completed',
      data: result,
    };
  }
}
