// src/modules/trust/trust-admin.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { TrustService, TrustScoreEvent } from './trust.service';
import { TrustStatsQueryDto, FireTrustEventDto } from './dto/trust-admin.dto';

@ApiTags('Super Admin — Trust Scores')
@Controller('superadmin/trust')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class TrustAdminController {
  constructor(private readonly trustService: TrustService) {}

  // ── GET /superadmin/trust ─────────────────────────────────────────────────

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Super Admin] List all user trust stats',
    description:
      'Returns paginated trust statistics for all users, ordered by trust score descending. ' +
      'Optionally filter by score range (minScore / maxScore are internal 0-100 scores; ' +
      'multiply by 5.5 and add 300 for the display score).',
  })
  async getAllTrustStats(@Query() query: TrustStatsQueryDto) {
    const result = await this.trustService.getAllTrustStats(query);
    return { success: true, message: 'Trust stats retrieved', ...result };
  }

  // ── GET /superadmin/trust/:userId ────────────────────────────────────────

  @Get(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Super Admin] Get full ATI breakdown for a specific user',
    description:
      'Returns the raw UserTrustStats record plus a component-by-component ATI breakdown ' +
      '(recentBehavior, historyBehavior, payoutReliability, peerScore, historyLength) ' +
      'so you can see exactly how the score is composed.',
  })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async getUserTrustStats(@Param('userId') userId: string) {
    const data = await this.trustService.getTrustStatsFull(userId);
    if (!data) {
      return {
        success: true,
        message: 'No trust stats found for this user — defaults apply',
        data: { userId, trustScore: 50, displayScore: 575, atiBreakdown: null },
      };
    }
    return { success: true, message: 'Trust stats retrieved', data };
  }

  // ── POST /superadmin/trust/:userId/event ─────────────────────────────────

  @Post(':userId/event')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Super Admin] Manually fire a trust-score event for a user',
    description: `
Fires one of the following trust events against a user's ATI record:
- **contribution_on_time** — counts as an on-time payment
- **contribution_late** — counts as a late payment
- **missed_payment** — missed contribution (×1.5 ATI penalty)
- **missed_payment_post_payout** — missed payment after receiving payout (sets isPostPayout=true)
- **missed_payment_post_payout_default** — escalated (×2.0 penalty: missed + default flag)
- **peer_rating** — apply a peer rating (requires rating: 1–5)
- **cycle_reset** — reset the "last cycle" rolling window

Use with caution — this directly modifies the user's ATI record.`,
  })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  async fireTrustEvent(@Param('userId') userId: string, @Body() dto: FireTrustEventDto) {
    const event = this.mapDtoToEvent(dto);
    await this.trustService.fireTrustEventAdmin(userId, event);

    const updated = await this.trustService.getTrustScore(userId);
    return {
      success: true,
      message: `Trust event '${dto.eventType}' applied to user ${userId}`,
      data: {
        userId,
        newTrustScore: (updated as any).trustScore,
        newDisplayScore: (updated as any).displayScore,
      },
    };
  }

  // ── Helper: map DTO fields → TrustScoreEvent union ───────────────────────

  private mapDtoToEvent(dto: FireTrustEventDto): TrustScoreEvent {
    switch (dto.eventType) {
      case 'contribution_on_time':
        return { type: 'contribution', onTime: true, isPostPayout: dto.isPostPayout ?? false };

      case 'contribution_late':
        return { type: 'contribution', onTime: false, isPostPayout: dto.isPostPayout ?? false };

      case 'missed_payment':
        return { type: 'missed_payment', isPostPayout: false };

      case 'missed_payment_post_payout':
        return { type: 'missed_payment', isPostPayout: true };

      case 'missed_payment_post_payout_default':
        return { type: 'missed_payment_post_payout_default' };

      case 'peer_rating':
        if (dto.rating === undefined || dto.rating < 1 || dto.rating > 5) {
          throw new BadRequestException('peer_rating requires a rating between 1 and 5');
        }
        return { type: 'peer_rating', rating: dto.rating };

      case 'cycle_reset':
        return { type: 'cycle_reset' };

      default:
        throw new BadRequestException(`Unknown event type: ${dto.eventType}`);
    }
  }
}
