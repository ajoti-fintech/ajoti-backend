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
  formatCircleResponse,
  formatMembershipResponse,
  RoscaCycleScheduleResponseDto,
  formatScheduleResponse,
  UpdatePayoutConfigDto,
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

  @Patch(':circleId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Admin] Verify and activate a ROSCA circle' })
  @ApiResponse({ status: 200, type: RoscaCircleResponseDto })
  async activateCircle(@Param('circleId') circleId: string, @Body() dto: ActivateCircleDto) {
    const circle = await this.roscaService.activateCircle(circleId, new Date(dto.startDate));
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
