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
import { SuperadminUsersService } from '../superadmin-users.service';
import { UserFilterDto, UpdateUserStatusDto } from '../dto/superadmin.dto';

@ApiTags('Super Admin — Users')
@Controller('superadmin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class SuperadminUsersController {
  constructor(private readonly usersService: SuperadminUsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Paginated user directory',
    description:
      'List all users with optional filtering by status, role, KYC status, registration date, and full-text search.',
  })
  async listUsers(@Query() dto: UserFilterDto) {
    return this.usersService.listUsers(dto);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Full user profile',
    description:
      'Returns user info, wallet balance, ROSCA participation, recent ledger activity, trust/credit scores, and outstanding debts.',
  })
  async getUserDetail(@Param('userId') userId: string) {
    return this.usersService.getUserDetail(userId);
  }

  @Patch(':userId/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update user account status',
    description: 'Suspend, ban, or reactivate a user. Logs the action to the audit trail.',
  })
  async updateStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
    @Request() req: any,
  ) {
    const result = await this.usersService.updateUserStatus(req.user.id, userId, dto);
    return { success: true, data: result };
  }

  @Patch(':userId/promote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Promote a user to SUPERADMIN',
    description: 'Elevates any MEMBER or ADMIN to the SUPERADMIN role. Logs the action to the audit trail.',
  })
  async promote(@Param('userId') userId: string, @Request() req: any) {
    const result = await this.usersService.promoteToSuperadmin(req.user.userId, userId);
    return { success: true, data: result };
  }
}
