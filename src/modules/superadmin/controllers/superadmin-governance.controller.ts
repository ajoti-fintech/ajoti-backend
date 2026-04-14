import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { SuperadminGovernanceService } from '../superadmin-governance.service';
import { CircleGovernanceFilterDto, FlagMemberDto, PaginationDto } from '../dto/superadmin.dto';

@ApiTags('Super Admin — ROSCA Governance')
@Controller('superadmin/circles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class SuperadminGovernanceController {
  constructor(private readonly governanceService: SuperadminGovernanceService) {}

  @Get()
  @ApiOperation({
    summary: 'Paginated circle directory',
    description: 'List all ROSCA circles with optional filter by status and full-text search on name or admin.',
  })
  async listCircles(@Query() dto: CircleGovernanceFilterDto) {
    return this.governanceService.listCircles(dto);
  }

  @Get('defaulters')
  @ApiOperation({
    summary: 'Platform-wide defaulters',
    description: 'Paginated list of all unsettled missed-contribution debts across all circles.',
  })
  async getDefaulters(@Query() dto: PaginationDto) {
    return this.governanceService.getDefaulters(dto.page, dto.limit);
  }

  @Get(':circleId')
  @ApiOperation({
    summary: 'Full circle detail',
    description: 'Returns circle info, all members, cycle schedules, recent payouts, and outstanding debts.',
  })
  async getCircleDetail(@Param('circleId') circleId: string) {
    return this.governanceService.getCircleDetail(circleId);
  }

  @Patch(':circleId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force-cancel a circle',
    description: 'Cancels a DRAFT or ACTIVE circle. A reason is required and is logged to the audit trail.',
  })
  async cancelCircle(
    @Param('circleId') circleId: string,
    @Body() body: FlagMemberDto,
    @Request() req: any,
  ) {
    const result = await this.governanceService.cancelCircle(req.user.id, circleId, body.reason);
    return { success: true, data: result };
  }

  @Patch('members/:membershipId/flag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Flag a member as DEFAULTED',
    description:
      'Manually sets a membership status to DEFAULTED, locks their payout, and restricts circle joining. ' +
      'Logged to the audit trail.',
  })
  async flagMember(
    @Param('membershipId') membershipId: string,
    @Body() dto: FlagMemberDto,
    @Request() req: any,
  ) {
    const result = await this.governanceService.flagMember(req.user.id, membershipId, dto);
    return { success: true, data: result };
  }
}
