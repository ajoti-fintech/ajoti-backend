// src/modules/rosca/controllers/rosca.controller.ts
import {
  Controller,
  Post,
  Get,
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
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CircleService } from '../services/circle.service';
import { MembershipService } from '../services/membership.service';
import { InviteService } from '../services/invite.service';
import {
  ListCirclesQueryDto,
  RoscaCircleResponseDto,
  RoscaCycleScheduleResponseDto,
  formatCircleResponse,
  formatScheduleResponse,
} from '../dto/circle.dto';
import { RoscaMembershipResponseDto, formatMembershipResponse } from '../dto/membership.dto';
import { JoinByInviteDto } from '../dto/invite.dto';

@ApiTags('ROSCA')
@Controller('rosca')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class RoscaController {
  constructor(
    private readonly circleService: CircleService,
    private readonly membershipService: MembershipService,
    private readonly inviteService: InviteService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List available ROSCA circles (public)' })
  @ApiResponse({ status: 200, type: [RoscaCircleResponseDto] })
  async listCircles(@Query() query: ListCirclesQueryDto) {
    const circles = await this.circleService.listCircles(query);
    return {
      success: true,
      message: 'Circles retrieved successfully',
      data: circles.map(formatCircleResponse),
    };
  }

  @Get('my-join-requests')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all join requests submitted by the current user' })
  async getMyPendingJoinRequests(@CurrentUser('userId') userId: string) {
    const memberships = await this.membershipService.getMyJoinRequests(userId);
    return {
      success: true,
      message: 'Join requests retrieved successfully',
      data: memberships.map((m) => ({
        membershipId: m.id,
        circleId: m.circleId,
        status: m.status,
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
    return await this.membershipService.cancelJoinRequest(userId, circleId);
  }

  @Get('my-participations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all ROSCA circles the current user has been accepted into',
    description:
      'Returns circles where the user is an ACTIVE or COMPLETED member. ' +
      'Each circle includes the full member list with payout positions and trust scores. ' +
      'For the full circle detail (schedules, pot size, etc.) call GET /rosca/:circleId.',
  })
  @ApiResponse({ status: 200, type: [RoscaCircleResponseDto] })
  async getMyParticipations(@CurrentUser('userId') userId: string) {
    const circles = await this.circleService.getUserParticipations(userId);
    return {
      success: true,
      message: 'Your active participations retrieved successfully',
      data: circles.map(formatCircleResponse),
    };
  }

  @Get('my-rejections')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all ROSCA circles where the current user was rejected',
    description: 'Returns membership records (REJECTED status) with basic circle details.',
  })
  async getMyRejections(@CurrentUser('userId') userId: string) {
    const memberships = await this.membershipService.getMyRejectedRequests(userId);
    return {
      success: true,
      message: 'Rejected join requests retrieved successfully',
      data: memberships.map((m) => ({
        membershipId: m.id,
        circleId: m.circleId,
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

  @Get('my-invites')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get pending invites for the current user (matched by email)' })
  async getMyInvites(@CurrentUser('userId') userId: string) {
    const invites = await this.inviteService.getMyInvites(userId);
    return {
      success: true,
      message: 'Invites retrieved successfully',
      data: invites.map((invite) => ({
        ...invite,
        circle: {
          ...invite.circle,
          contributionAmount: invite.circle.contributionAmount.toString(),
        },
      })),
    };
  }

  @Get(':circleId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get detailed view of a specific ROSCA circle' })
  @ApiResponse({ status: 200, type: RoscaCircleResponseDto })
  async getCircle(@Param('circleId') circleId: string, @CurrentUser('userId') userId: string) {
    const circle = await this.circleService.getCircle(circleId, userId);
    return {
      success: true,
      message: 'Circle details retrieved successfully',
      data: formatCircleResponse(circle),
    };
  }

  @Post(':circleId/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request to join a circle (reserves collateral)' })
  @ApiResponse({ status: 200, type: RoscaMembershipResponseDto })
  async requestToJoin(@Param('circleId') circleId: string, @CurrentUser('userId') userId: string) {
    const membership = await this.membershipService.requestToJoin(userId, circleId);
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
    const schedules = await this.circleService.getSchedules(circleId);
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
    const result = await this.membershipService.leaveCircle(circleId, userId);
    return {
      success: true,
      message: result.message,
    };
  }

  @Get('invite-preview/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get invite details by token (before accepting)' })
  async getInvitePreview(@Param('token') token: string) {
    const data = await this.inviteService.getInvitePreview(token);
    return { success: true, data };
  }

  @Post('join-by-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join a private ROSCA circle using an invite token' })
  @ApiResponse({ status: 200, type: RoscaMembershipResponseDto })
  async joinByInvite(@CurrentUser('userId') userId: string, @Body() dto: JoinByInviteDto) {
    const membership = await this.inviteService.joinByInvite(userId, dto.token);
    return {
      success: true,
      message: 'Joined circle successfully. Awaiting admin approval.',
      data: formatMembershipResponse(membership),
    };
  }
}
