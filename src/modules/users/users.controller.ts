import { Body, Controller, Delete, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { DeleteUserAccountDto } from './dto/delete-user.dto';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user profile and account status' })
  @ApiResponse({ status: 200, description: 'User profile retrieved successfully' })
  async getMyProfile(@CurrentUser('userId') userId: string) {
    const user = await this.usersService.findById(userId);
    return {
      success: true,
      message: 'Profile retrieved successfully',
      data: user,
    };
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close current user account',
    description:
      'Closes the account safely: validates password, ensures no active obligations, deletes VA at provider, closes wallet, revokes sessions, and anonymizes user profile.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid password or invalid confirmation phrase.',
  })
  @ApiConflictResponse({
    description: 'Account has active obligations or non-zero wallet balance.',
  })
  @ApiServiceUnavailableResponse({
    description: 'Provider-side VA deletion failed.',
  })
  async closeMyAccount(@CurrentUser('userId') userId: string, @Body() dto: DeleteUserAccountDto) {
    const result = await this.usersService.closeAccount(userId, dto);
    return {
      success: true,
      ...result,
    };
  }
}
