// src/modules/rosca/rosca.controller.ts
import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RoscaService } from './rosca.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

import { CurrentUser } from '@/common/decorators/current-user.decorator';
import {
  CreateRoscaCircleDto,
  ListCirclesQueryDto,
  ActivateCircleDto,
  RoscaCircleResponseDto,
  RoscaMembershipResponseDto,
  AdminListCirclesQueryDto,
  JoinRequestSearchQueryDto,
  AdminDashboardResponseDto,
  PendingCircleOverviewDto,
  JoinRequesterDossierDto,
  MyPendingJoinRequestDto,
  formatCircleResponse,
  formatMembershipResponse,
  RoscaCycleScheduleResponseDto,
  formatScheduleResponse,
  UpdatePayoutConfigDto,
  UpdateCircleDto,
  MemberProgressResponseDto,
  ContributionsInResponseDto,
  DisbursementScheduleResponseDto,
  FinancialHealthResponseDto,
  RoundQueryDto,
  CreateInviteDto,
  JoinByInviteDto,
  InviteResponseDto,
} from './dto/rosca.dto';
import { Roles } from '@/common/decorators/roles.decorator';

@ApiTags('ROSCA')
@Controller('rosca')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class RoscaController {
  constructor(private readonly roscaService: RoscaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List available ROSCA circles (public)' })
  @ApiResponse({ status: 200, type: [RoscaCircleResponseDto] })
  async listCircles(@Query() query: ListCirclesQueryDto) {
    const circles = await this.roscaService.listCircles(query);
    return {
      success: true,
      message: 'Circles retrieved successfully',
      data: circles.map(formatCircleResponse),
    };
  }

  @Get('my-join-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all pending join requests submitted by the current user' })
  @ApiResponse({ status: 200, type: [MyPendingJoinRequestDto] })
  async getMyPendingJoinRequests(@CurrentUser('userId') userId: string) {
    const memberships = await this.roscaService.getMyPendingJoinRequests(userId);
    return {
      success: true,
      message: 'Pending join requests retrieved successfully',
      data: memberships.map((m) => ({
        membershipId: m.id,
        circleId: m.circleId,
        collateralReserved: m.collateralAmount.toString(),
        requestedAt: m.joinedAt,
        circle: {
          id: m.circle.id,
          name: m.circle.name,
          contributionAmount: m.circle.contributionAmount.toString(),
          frequency: m.circle.frequency,
          maxSlots: m.circle.maxSlots,
          filledSlots: m.circle.filledSlots,
          status: m.circle.status,
        },
      })),
    };
  }

  @Delete(':circleId/join-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending join request and reclaim reserved collateral' })
  async cancelJoinRequest(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') userId: string,
  ) {
    return await this.roscaService.cancelJoinRequest(userId, circleId);
  }

  @Get('my-participations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all ROSCA circles the current user is a member of' })
  @ApiResponse({ status: 200, type: [RoscaCircleResponseDto] })
  async getMyParticipations(@CurrentUser('userId') userId: string) {
    const circles = await this.roscaService.getUserParticipations(userId);
    return {
      success: true,
      message: 'Your active participations retrieved successfully',
      data: circles.map(formatCircleResponse),
    };
  }

  @Get(':circleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get detailed view of a specific ROSCA circle' })
  @ApiResponse({ status: 200, type: RoscaCircleResponseDto })
  async getCircle(@Param('circleId') circleId: string, @CurrentUser('userId') userId: string) {
    const circle = await this.roscaService.getCircle(circleId, userId);
    return {
      success: true,
      message: 'Circle details retrieved successfully',
      data: formatCircleResponse(circle), // This should now include admin/creator info
    };
  }

  @Post(':circleId/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request to join a circle (reserves collateral)' })
  @ApiResponse({ status: 200, type: RoscaMembershipResponseDto })
  async requestToJoin(@Param('circleId') circleId: string, @CurrentUser('userId') userId: string) {
    const membership = await this.roscaService.requestToJoin(userId, circleId);
    return {
      success: true,
      message: 'Join request submitted and collateral reserved',
      data: formatMembershipResponse(membership),
    };
  }

  @Get(':circleId/schedules')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get payment schedule for a circle' })
  @ApiResponse({ status: 200, type: [RoscaCycleScheduleResponseDto] })
  async getSchedules(@Param('circleId') circleId: string) {
    const schedules = await this.roscaService.getSchedules(circleId);
    return {
      success: true,
      message: 'Schedules retrieved successfully',
      data: schedules.map(formatScheduleResponse),
    };
  }

  @Delete(':circleId/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Leave a circle (before activation)' })
  async leaveCircle(@Param('circleId') circleId: string, @CurrentUser('userId') userId: string) {
    const result = await this.roscaService.leaveCircle(circleId, userId);
    return {
      success: true,
      message: result.message,
    };
  }

  @Post('join-by-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join a private ROSCA circle using an invite token' })
  @ApiResponse({ status: 200, type: RoscaMembershipResponseDto })
  async joinByInvite(@CurrentUser('userId') userId: string, @Body() dto: JoinByInviteDto) {
    const membership = await this.roscaService.joinByInvite(userId, dto.token);
    return {
      success: true,
      message: 'Joined circle successfully. Awaiting admin approval.',
      data: formatMembershipResponse(membership),
    };
  }
}

// ────────────────────────────────────────────────
// ADMIN CONTROLLER - Explicitly Exported
// ────────────────────────────────────────────────

@ApiTags('ROSCA Admin')
@Controller('admin/rosca')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
@ApiBearerAuth('access-token')
export class RoscaAdminController {
  constructor(private readonly roscaService: RoscaService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new ROSCA circle' })
  @ApiResponse({ status: 201, type: RoscaCircleResponseDto })
  async createCircle(@CurrentUser('userId') userId: string, @Body() dto: CreateRoscaCircleDto) {
    const circle = await this.roscaService.createCircle(userId, dto);
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
    const data = await this.roscaService.getAdminDashboard(adminId);
    return { success: true, message: 'Dashboard retrieved successfully', data };
  }

  @Get('join-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Admin] List all circles with pending join requests, grouped by circle',
  })
  @ApiResponse({ status: 200, type: [PendingCircleOverviewDto] })
  async getPendingJoinRequestsOverview(@CurrentUser('userId') adminId: string) {
    const data = await this.roscaService.getPendingJoinRequestsOverview(adminId);
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
    const data = await this.roscaService.getCircleJoinRequests(circleId, adminId, query.search);
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
    // Force the query to only look for circles belonging to this admin
    const circles = await this.roscaService.adminListAllCircles({
      ...query,
      adminId,
    });

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
    const data = await this.roscaService.getMemberProgress(circleId, adminId);
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
    const data = await this.roscaService.getContributionsIn(circleId, adminId, query.round);
    return { success: true, message: 'Contributions retrieved successfully', data };
  }

  @Get(':circleId/disbursements')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Get full disbursement schedule for a circle' })
  @ApiResponse({ status: 200, type: DisbursementScheduleResponseDto })
  async getDisbursementSchedule(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const data = await this.roscaService.getDisbursementSchedule(circleId, adminId);
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
    const data = await this.roscaService.getFinancialHealth(circleId, adminId);
    return { success: true, message: 'Financial health retrieved successfully', data };
  }

  @Post(':circleId/notify-missing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Notify members who have not contributed in a given round' })
  async notifyMissingMembers(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
    @Query() query: RoundQueryDto,
  ) {
    const data = await this.roscaService.notifyMissingMembers(circleId, adminId, query.round);
    return { success: true, message: `Notified ${data.notified} missing member(s) for cycle ${data.cycleNumber}`, data };
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
    const invite = await this.roscaService.createInvite(circleId, adminId, dto.email);
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
    const data = await this.roscaService.listInvites(circleId, adminId);
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
    const result = await this.roscaService.revokeInvite(circleId, inviteId, adminId);
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
    const circle = await this.roscaService.getCircleByIdForAdmin(circleId, adminId);
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
    const circle = await this.roscaService.activateCircle(
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
  async approveMember(
    @Param('circleId') circleId: string,
    @Param('userId') userId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const membership = await this.roscaService.approveMember(circleId, adminId, userId);
    return {
      success: true,
      message: 'Member approved successfully',
      data: formatMembershipResponse(membership),
    };
  }

  @Patch(':circleId/members/:userId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a member and release their collateral (Circle Admin only)' })
  async rejectMember(
    @Param('circleId') circleId: string,
    @Param('userId') userId: string,
    @CurrentUser('userId') adminId: string,
  ) {
    const membership = await this.roscaService.rejectMember(circleId, adminId, userId);
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
    @Body() updateDto: UpdateCircleDto, // Use UpdateCircleDto here
  ) {
    const circle = await this.roscaService.updateCircle(circleId, userId, updateDto);
    return {
      success: true,
      message: 'Circle updated successfully',
      data: formatCircleResponse(circle),
    };
  }

  @Patch(':circleId/payout-config')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Update payout logic or assign member positions' })
  async updatePayoutConfig(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: UpdatePayoutConfigDto,
  ) {
    return await this.roscaService.updatePayoutConfiguration(circleId, adminId, dto);
  }
}

// ────────────────────────────────────────────────
// SUPER ADMIN CONTROLLER - Explicitly Exported
// ────────────────────────────────────────────────

@ApiTags('ROSCA Super Admin')
@Controller('superadmin/rosca')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class RoscaSuperAdminController {
  constructor(private readonly roscaService: RoscaService) {}

  @Get('all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] View all circles regardless of visibility' })
  @ApiResponse({ status: 200, type: [RoscaCircleResponseDto] })
  async getAllCircles(@Query() query: AdminListCirclesQueryDto) {
    const circles = await this.roscaService.adminListAllCircles(query);
    return {
      success: true,
      message: 'All circles retrieved',
      data: circles.map(formatCircleResponse),
    };
  }
}
