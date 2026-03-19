// src/modules/funding/funding.controller.ts
import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { FundingService } from './funding.service';
import { InitializeFundingDto, FundingResponseDto } from './dto/funding.dto';

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
