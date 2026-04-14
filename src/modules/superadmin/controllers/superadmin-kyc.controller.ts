import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { SuperadminKycService } from '../superadmin-kyc.service';
import { KycQueueFilterDto } from '../dto/superadmin.dto';

@ApiTags('Super Admin — KYC')
@Controller('superadmin/kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class SuperadminKycController {
  constructor(private readonly kycService: SuperadminKycService) {}

  @Get()
  @ApiOperation({
    summary: 'KYC approval queue',
    description:
      'Paginated list of KYC records filtered by status (default: PENDING). ' +
      'To approve or reject, use PATCH /kyc/approve/:userId or /kyc/reject/:userId.',
  })
  async listQueue(@Query() dto: KycQueueFilterDto) {
    return this.kycService.listKycQueue(dto);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Full KYC detail for a user',
    description: 'Returns the complete KYC record including all submitted documents and verification timestamps.',
  })
  async getDetail(@Param('userId') userId: string) {
    return this.kycService.getKycDetail(userId);
  }
}
