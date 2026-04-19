// src/modules/rosca/controllers/rosca-superadmin.controller.ts
import { Controller, Get, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { AdminOversightService } from '../services/admin-oversight.service';
import { AdminListCirclesQueryDto } from '../dto/admin.dto';
import { RoscaCircleResponseDto, formatCircleResponse } from '../dto/circle.dto';

@ApiTags('ROSCA Super Admin')
@Controller('superadmin/rosca')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class RoscaSuperAdminController {
  constructor(private readonly adminOversightService: AdminOversightService) {}

  @Get('all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[Super Admin] View all circles regardless of visibility' })
  @ApiResponse({ status: 200, type: [RoscaCircleResponseDto] })
  async getAllCircles(@Query() query: AdminListCirclesQueryDto) {
    const circles = await this.adminOversightService.adminListAllCircles(query);
    return {
      success: true,
      message: 'All circles retrieved',
      data: circles.map(formatCircleResponse),
    };
  }
}
