// src/modules/peer-review/peer-review.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SubmitReviewDto, ReviewItemDto, ReviewSummaryItemDto } from './dto/peer-review.dto';
import { PeerReviewService } from './peer-review.service';

@ApiTags('Peer Reviews')
@Controller('rosca/:circleId/reviews')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class PeerReviewController {
  constructor(private readonly peerReviewService: PeerReviewService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Submit a peer review for a circle member or admin',
    description:
      'Can be submitted by any member or the admin of the circle. ' +
      'Only allowed after the circle has COMPLETED. ' +
      'One review per reviewer per reviewee per circle. ' +
      'Reviews are not anonymous. ' +
      'Ratings for members update their trust score; ratings for the admin are internal feedback only.',
  })
  @ApiResponse({ status: 201, type: ReviewItemDto })
  async submitReview(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') reviewerId: string,
    @Body() dto: SubmitReviewDto,
  ) {
    const data = await this.peerReviewService.submitReview(circleId, reviewerId, dto);
    return { success: true, message: 'Review submitted successfully', data };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({
    summary: 'List reviews for a circle',
    description:
      'Admin: returns reviews about members only (not reviews about the admin). ' +
      'Super admin: returns all reviews in the circle.',
  })
  @ApiResponse({ status: 200, type: [ReviewItemDto] })
  async getReviews(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') requesterId: string,
    @CurrentUser('role') role: Role,
  ) {
    const data = await this.peerReviewService.getReviews(circleId, requesterId, role);
    return { success: true, message: 'Reviews retrieved successfully', data };
  }

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiOperation({
    summary: 'Get aggregated review summary per member',
    description:
      'Returns average rating and review count per reviewee. ' +
      'Admin sees member summaries only. Super admin sees all.',
  })
  @ApiResponse({ status: 200, type: [ReviewSummaryItemDto] })
  async getReviewSummary(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') requesterId: string,
    @CurrentUser('role') role: Role,
  ) {
    const data = await this.peerReviewService.getReviewSummary(circleId, requesterId, role);
    return { success: true, message: 'Review summary retrieved successfully', data };
  }
}
