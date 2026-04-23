// src/modules/rosca/controllers/rosca-admin.controller.ts
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CircleService } from '../services/circle.service';
import { MembershipService } from '../services/membership.service';
import { AdminOversightService } from '../services/admin-oversight.service';
import { InviteService } from '../services/invite.service';
import {
  CreateRoscaCircleDto,
  ActivateCircleDto,
  UpdateCircleDto,
  UpdatePayoutConfigDto,
  PayoutConfigResponseDto,
  RoscaCircleResponseDto,
  formatCircleResponse,
} from '../dto/circle.dto';
import { RoscaMembershipResponseDto, formatMembershipResponse } from '../dto/membership.dto';
import {
  AdminListCirclesQueryDto,
  JoinRequestSearchQueryDto,
  AdminDashboardResponseDto,
  PendingCircleOverviewDto,
  JoinRequesterDossierDto,
  MemberProgressResponseDto,
  ContributionsInResponseDto,
  DisbursementScheduleResponseDto,
  FinancialHealthResponseDto,
  RoundQueryDto,
  NotifyMembersDto,
} from '../dto/admin.dto';
import { CreateInviteDto, InviteResponseDto } from '../dto/invite.dto';

@ApiTags('ROSCA Admin')
@Controller('admin/rosca')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
@ApiBearerAuth('access-token')
export class RoscaAdminController {
  constructor(
    private readonly circleService: CircleService,
    private readonly membershipService: MembershipService,
    private readonly adminOversightService: AdminOversightService,
    private readonly inviteService: InviteService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new ROSCA circle' })
  @ApiResponse({ status: 201, type: RoscaCircleResponseDto })
  async createCircle(@CurrentUser('userId') userId: string, @Body() dto: CreateRoscaCircleDto) {
    const circle = await this.circleService.createCircle(userId, dto);
    return {
      success: true,
      message: 'Circle created successfully in DRAFT mode',
      data: formatCircleResponse(circle),
    };
  }

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Get dashboard summary: total groups, next deadline, pending requests',
  })
  @ApiResponse({ status: 200, type: AdminDashboardResponseDto })
  async getDashboard(@CurrentUser('userId') adminId: string) {
    const data = await this.adminOversightService.getAdminDashboard(adminId);
    return { success: true, message: 'Dashboard retrieved successfully', data };
  }

  @Get('join-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] List all circles with pending join requests, grouped by circle',
  })
  @ApiResponse({ status: 200, type: [PendingCircleOverviewDto] })
  async getPendingJoinRequestsOverview(@CurrentUser('userId') adminId: string) {
    const data = await this.adminOversightService.getPendingJoinRequestsOverview(adminId);
    return { success: true, message: 'Pending join requests retrieved successfully', data };
  }

  @Get(':circleId/join-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Get requester dossiers for a specific circle, with optional name search',
  })
  @ApiResponse({ status: 200, type: [JoinRequesterDossierDto] })
  async getCircleJoinRequests(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
    @Query() query: JoinRequestSearchQueryDto,
  ) {
    const data = await this.adminOversightService.getCircleJoinRequests(
      circleId,
      adminId,
      query.search,
    );
    return { success: true, message: 'Join requests retrieved successfully', data };
  }

  @Get('my-circles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get all ROSCA circles created by the current admin' })
  @ApiResponse({ status: 200, type: [RoscaCircleResponseDto] })
  async getMyAdminCircles(
    @CurrentUser('userId') adminId: string,
    @Query() query: AdminListCirclesQueryDto,
  ) {
    const circles = await this.adminOversightService.adminListAllCircles({ ...query, adminId });
    return {
      success: true,
      message: 'Admin circles retrieved successfully',
      data: circles.map(formatCircleResponse),
    };
  }

  @Get(':circleId/members/progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get member lifecycle progress for a circle' })
  @ApiResponse({ status: 200, type: MemberProgressResponseDto })
  async getMemberProgress(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.adminOversightService.getMemberProgress(circleId, adminId);
    return { success: true, message: 'Member progress retrieved successfully', data };
  }

  @Get(':circleId/contributions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get contributions received for a specific round' })
  @ApiResponse({ status: 200, type: ContributionsInResponseDto })
  async getContributionsIn(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
    @Query() query: RoundQueryDto,
  ) {
    const data = await this.adminOversightService.getContributionsIn(
      circleId,
      adminId,
      query.round,
    );
    return { success: true, message: 'Contributions retrieved successfully', data };
  }

  @Get(':circleId/contributions-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get all contributions for a circle across all cycles' })
  async getAllContributions(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.adminOversightService.getAllContributions(circleId, adminId);
    return { success: true, message: 'All contributions retrieved successfully', data };
  }

  @Get(':circleId/disbursements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get full disbursement schedule for a circle' })
  @ApiResponse({ status: 200, type: DisbursementScheduleResponseDto })
  async getDisbursementSchedule(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.adminOversightService.getDisbursementSchedule(circleId, adminId);
    return { success: true, message: 'Disbursement schedule retrieved successfully', data };
  }

  @Get(':circleId/financial-health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get per-cycle financial health overview' })
  @ApiResponse({ status: 200, type: FinancialHealthResponseDto })
  async getFinancialHealth(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.adminOversightService.getFinancialHealth(circleId, adminId);
    return { success: true, message: 'Financial health retrieved successfully', data };
  }

  @Post(':circleId/notify-missing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Notify members who have not contributed in a given round' })
  async notifyMissingMembers(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
    @Query() query: RoundQueryDto,
    @Body() body: NotifyMembersDto,
  ) {
    const data = await this.adminOversightService.notifyMissingMembers(
      circleId,
      adminId,
      query.round,
      body.message,
      body.memberIds,
    );
    return {
      success: true,
      message: `Notified ${data.notified} missing member(s) for cycle ${data.cycleNumber}`,
      data,
    };
  }

  @Post(':circleId/notify-top-up')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Notify active members whose wallet balance is below the contribution amount',
    description:
      'Checks every active member\'s available balance against the circle\'s contribution amount. ' +
      'Sends an email + in-app notification only to those who are below the threshold.',
  })
  async notifyLowBalance(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.adminOversightService.notifyLowBalanceMembers(circleId, adminId);
    return {
      success: true,
      message: `Notified ${data.notified} of ${data.total} member(s) with insufficient balance`,
      data,
    };
  }

  @Post(':circleId/invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Admin] Send an invite to a person to join a private circle' })
  @ApiResponse({ status: 201, type: InviteResponseDto })
  async createInvite(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: CreateInviteDto,
  ) {
    const invite = await this.inviteService.createInvite(circleId, adminId, dto.email);
    return { success: true, message: 'Invite created successfully', data: invite };
  }

  @Get(':circleId/invites')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] List all invites for a private circle' })
  @ApiResponse({ status: 200, type: [InviteResponseDto] })
  async listInvites(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.inviteService.listInvites(circleId, adminId);
    return { success: true, message: 'Invites retrieved successfully', data };
  }

  @Delete(':circleId/invites/:inviteId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Revoke an unused invite' })
  async revokeInvite(
    @Param('circleId') circleId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const result = await this.inviteService.revokeInvite(circleId, inviteId, adminId);
    return { success: true, message: result.message };
  }

  @Get(':circleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get full details of a specific ROSCA circle' })
  @ApiResponse({ status: 200, type: RoscaCircleResponseDto })
  async getCircleDetails(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const circle = await this.circleService.getCircleByIdForAdmin(circleId, adminId);
    return {
      success: true,
      message: 'Circle details retrieved successfully',
      data: formatCircleResponse(circle),
    };
  }

  @Patch(':circleId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Verify and activate a ROSCA circle' })
  @ApiResponse({ status: 200, type: RoscaCircleResponseDto })
  async activateCircle(@Param('circleId') circleId: string, @Body() dto: ActivateCircleDto) {
    const circle = await this.circleService.activateCircle(
      circleId,
      new Date(dto.initialContributionDeadline),
    );
    return {
      success: true,
      message: 'Circle verified and activated. Schedules generated.',
      data: formatCircleResponse(circle),
    };
  }

  @Patch(':circleId/members/:userId/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a member (Circle Admin only)' })
  @ApiResponse({ status: 200, type: RoscaMembershipResponseDto })
  async approveMember(
    @Param('circleId') circleId: string,
    @Param('userId') userId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const membership = await this.membershipService.approveMember(circleId, adminId, userId);
    return {
      success: true,
      message: 'Member approved successfully',
      data: formatMembershipResponse(membership),
    };
  }

  @Patch(':circleId/members/:userId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a member and release their collateral (Circle Admin only)' })
  @ApiResponse({ status: 200, type: RoscaMembershipResponseDto })
  async rejectMember(
    @Param('circleId') circleId: string,
    @Param('userId') userId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const membership = await this.membershipService.rejectMember(circleId, adminId, userId);
    return {
      success: true,
      message: 'Member rejected and collateral released',
      data: formatMembershipResponse(membership),
    };
  }

  @Patch(':circleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Update circle configuration (DRAFT only)' })
  @ApiResponse({ status: 200, type: RoscaCircleResponseDto })
  async updateCircle(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') userId: string,
    @Body() updateDto: UpdateCircleDto,
  ) {
    const circle = await this.circleService.updateCircle(circleId, userId, updateDto);
    return {
      success: true,
      message: 'Circle updated successfully',
      data: formatCircleResponse(circle),
    };
  }

  @Get(':circleId/payout-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get current payout logic and member position assignments' })
  @ApiResponse({ status: 200, type: PayoutConfigResponseDto })
  async getPayoutConfig(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.circleService.getPayoutConfiguration(circleId, adminId);
    return { success: true, message: 'Payout configuration retrieved', data };
  }

  @Patch(':circleId/payout-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] Update payout logic or assign member positions',
    description:
      'Only allowed while the circle is in DRAFT status. ' +
      'If switching to ADMIN_ASSIGNED, include `assignments` with a position for every active member. ' +
      'Positions must be unique integers ≥ 1. All members must be assigned before the circle can be activated.',
  })
  @ApiResponse({ status: 200, description: 'Payout configuration updated successfully' })
  async updatePayoutConfig(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: UpdatePayoutConfigDto,
  ) {
    return await this.circleService.updatePayoutConfiguration(circleId, adminId, dto);
  }
}
