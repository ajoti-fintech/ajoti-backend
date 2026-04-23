import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { LoanService } from './loans.service';
import { ApplyLoanDto, LoanEligibilityQueryDto } from './dto/loan.dto';

@ApiTags('Loans')
@Controller('loan')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('access-token')
export class LoanController {
  constructor(private readonly loanService: LoanService) {}

  @Get('eligibility')
  @ApiOperation({ summary: 'Check loan eligibility for a circle' })
  @ApiQuery({ name: 'circleId', required: true, type: String })
  async getEligibility(
    @CurrentUser('userId') userId: string,
    @Query() query: LoanEligibilityQueryDto,
  ) {
    const result = await this.loanService.getLoanEligibility(userId, query.circleId);
    return {
      success: true,
      data: result,
    };
  }

  @Post('apply')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Apply for a loan against your expected payout' })
  async applyLoan(@CurrentUser('userId') userId: string, @Body() dto: ApplyLoanDto) {
    const loan = await this.loanService.applyLoan(userId, dto.circleId);
    return {
      success: true,
      message: 'Loan applied successfully. Amount credited to your wallet.',
      data: loan,
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get your current active loan' })
  async getLoanStatus(@CurrentUser('userId') userId: string) {
    const loan = await this.loanService.getActiveLoan(userId);

    if (!loan) {
      throw new NotFoundException('No active loan found');
    }

    return {
      success: true,
      data: loan,
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'Get your full loan history' })
  async getLoanHistory(@CurrentUser('userId') userId: string) {
    const loans = await this.loanService.getLoanHistory(userId);
    return {
      success: true,
      data: loans,
    };
  }
}
