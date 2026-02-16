import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Patch,
} from '@nestjs/common';
import { KycService } from './kyc.service';
import { VerifyNinDto, VerifyBvnDto, VerifyNokDto, KycResponseDto } from './dto/kyc.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthRequest } from '@/common/types/auth-request';
import { Throttle } from '@nestjs/throttler';

@ApiTags('KYC')
@Controller('kyc')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('status')
  @Throttle({ default: { ttl: 60_000, limit: 20 } }) // 20/min
  @ApiOperation({ summary: 'Get KYC status for current user' })
  @ApiResponse({ status: 200, description: 'KYC status retrieved successfully' })
  @ApiResponse({ status: 404, description: 'KYC record not found' })
  async getKycStatus(@Request() req: AuthRequest): Promise<KycResponseDto> {
    return this.kycService.getKycStatus(req.user.userId);
  }

  @Post('initialize')
  @Throttle({ default: { ttl: 600_000, limit: 5 } }) // 5/10min
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Initialize KYC process for current user' })
  @ApiResponse({ status: 201, description: 'KYC initialized successfully' })
  async initializeKyc(@Request() req: AuthRequest): Promise<KycResponseDto> {
    const kyc = await this.kycService.initializeKyc(req.user.userId);
    return this.kycService.getKycStatus(kyc.userId);
  }

  @Post('verify-nin')
  @Throttle({ default: { ttl: 600_000, limit: 5 } }) // 5/10min
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify NIN (National Identification Number)' })
  @ApiResponse({ status: 200, description: 'NIN verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid KYC step or data' })
  @ApiResponse({ status: 422, description: 'NIN verification failed' })
  async verifyNin(
    @Request() req: AuthRequest,
    @Body() verifyNinDto: VerifyNinDto,
  ): Promise<KycResponseDto> {
    return this.kycService.verifyNin(req.user.userId, verifyNinDto);
  }

  @Post('verify-bvn')
  @Throttle({ default: { ttl: 600_000, limit: 5 } }) // 5/10min
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify BVN (Bank Verification Number)' })
  @ApiResponse({ status: 200, description: 'BVN verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid KYC step or data' })
  @ApiResponse({ status: 422, description: 'BVN verification failed' })
  async verifyBvn(
    @Request() req: AuthRequest,
    @Body() verifyBvnDto: VerifyBvnDto,
  ): Promise<KycResponseDto> {
    return this.kycService.verifyBvn(req.user.userId, verifyBvnDto);
  }

  @Post('submit-nok')
  @Throttle({ default: { ttl: 600_000, limit: 5 } }) // 5/10min
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit Next of Kin information' })
  @ApiResponse({ status: 200, description: 'Next of Kin submitted successfully' })
  @ApiResponse({ status: 400, description: 'Invalid KYC step or data' })
  async submitNextOfKin(
    @Request() req: AuthRequest,
    @Body() verifyNokDto: VerifyNokDto,
  ): Promise<KycResponseDto> {
    return this.kycService.submitNextOfKin(req.user.userId, verifyNokDto);
  }

  // SUPERADMIN ENDPOINTS
  @Patch('superadmin/approve/:userId')
  @Throttle({ default: { ttl: 600_000, limit: 30 } }) // 30/10min
  @UseGuards(RolesGuard)
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Approve KYC' })
  @ApiResponse({ status: 200, description: 'KYC approved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid KYC state' })
  @ApiResponse({ status: 404, description: 'KYC record not found' })
  async approveKyc(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
  ): Promise<KycResponseDto> {
    return this.kycService.approveKyc(userId, req.user.userId);
  }

  @Patch('superadmin/reject/:userId')
  @Throttle({ default: { ttl: 600_000, limit: 30 } }) // 30/10min
  @UseGuards(RolesGuard)
  @Roles('SUPERADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Reject KYC' })
  @ApiResponse({ status: 200, description: 'KYC rejected successfully' })
  @ApiResponse({ status: 400, description: 'Invalid KYC state' })
  @ApiResponse({ status: 404, description: 'KYC record not found' })
  async rejectKyc(
    @Request() req: AuthRequest,
    @Param('userId') userId: string,
    @Body('rejectionReason') rejectionReason: string,
  ): Promise<KycResponseDto> {
    return this.kycService.rejectKyc(userId, req.user.userId, rejectionReason);
  }
}
