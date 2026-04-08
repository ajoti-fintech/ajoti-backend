// src/modules/contribution/contribution.controller.ts
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  HttpStatus,
  HttpCode,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ContributionService } from './contribution.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  RoscaContributionResponseDto,
  formatContributionResponse,
  CreateContributionDto,
  ListContributionsQueryDto,
} from './dto/contribution.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Contributions')
@Controller('rosca/:circleId/contributions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class ContributionController {
  constructor(private readonly contributionService: ContributionService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make a cycle contribution' })
  @ApiResponse({ status: 200, type: RoscaContributionResponseDto })
  async makeContribution(
    @Param('circleId') circleId: string,
    @Body() dto: CreateContributionDto,
    @CurrentUser('userId') userId: string,
  ) {
    const contribution = await this.contributionService.makeContribution(
      userId,
      circleId,
      dto.cycleNumber,
    );
    return {
      success: true,
      message: 'Contribution successful',
      data: formatContributionResponse(contribution),
    };
  }

  // src/modules/contribution/contribution.controller.ts

  @Get()
  @ApiOperation({ summary: 'Get my contribution history for this circle' })
  @ApiResponse({ status: 200, type: [RoscaContributionResponseDto] })
  async getContributions(
    @Param('circleId') circleId: string,
    @CurrentUser('userId') userId: string,
    @Query() query: ListContributionsQueryDto, // Strictly typed
  ) {
    const contributions = await this.contributionService.getContributions(circleId, userId, query);

    return {
      success: true,
      data: contributions.map(formatContributionResponse),
    };
  }
}
