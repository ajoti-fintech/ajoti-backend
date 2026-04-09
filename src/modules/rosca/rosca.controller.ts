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
