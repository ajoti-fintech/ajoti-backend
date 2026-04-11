import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { DeleteUserAccountDto } from './dto/delete-user.dto';
import { UserProfileResponseDto } from './dto/user-profile.dto';
import { UpdateMyProfileDto, VerifyPendingEmailChangeDto } from './dto/update-profile.dto';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserProfileResponseDto,
  })
  async getMyProfile(@CurrentUser('userId') userId: string) {
    const profile = await this.usersService.getMyProfile(userId);
    return {
      success: true,
      message: 'Profile retrieved successfully',
      data: profile,
    };
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
    type: UserProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid payload, no-op update, or missing current password for sensitive changes.',
  })
  @ApiConflictResponse({
    description: 'Email is already in use.',
  })
  async updateMyProfile(@CurrentUser('userId') userId: string, @Body() dto: UpdateMyProfileDto) {
    const result = await this.usersService.updateMyProfile(userId, dto);
    return {
      success: true,
      ...result,
    };
  }

  @Post('me/email/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a pending email change' })
  @ApiResponse({
    status: 200,
    description: 'Pending email change verified successfully',
    type: UserProfileResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid or expired OTP, or there is no pending email change.',
  })
  @ApiConflictResponse({
    description: 'Email is already in use.',
  })
  async verifyPendingEmailChange(
    @CurrentUser('userId') userId: string,
    @Body() dto: VerifyPendingEmailChangeDto,
  ) {
    const result = await this.usersService.verifyPendingEmailChange(userId, dto.otp);
    return {
      success: true,
      ...result,
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
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async closeMyAccount(@CurrentUser('userId') userId: string, @Body() dto: DeleteUserAccountDto) {
    const result = await this.usersService.closeAccount(userId, dto);
    return {
      success: true,
      ...result,
    };
  }
}
