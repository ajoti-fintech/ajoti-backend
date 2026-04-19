import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProduces } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { SuperadminAuditService } from '../superadmin-audit.service';
import { LedgerQueryDto, AuditLogQueryDto, ExportQueryDto } from '../dto/superadmin.dto';

@ApiTags('Super Admin — Audit & Ledger')
@Controller('superadmin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@ApiBearerAuth('access-token')
export class SuperadminAuditController {
  constructor(private readonly auditService: SuperadminAuditService) {}

  @Get('ledger')
  @ApiOperation({
    summary: 'Global ledger browser',
    description: 'Paginated ledger entries across all wallets. Filter by userId, reference, sourceType, or date range.',
  })
  async getLedger(@Query() dto: LedgerQueryDto) {
    return this.auditService.getLedgerEntries(dto);
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Audit log',
    description: 'Paginated audit trail of all admin actions. Filter by actorId, entityType, action, or date range.',
  })
  async getAuditLogs(@Query() dto: AuditLogQueryDto) {
    return this.auditService.getAuditLogs(dto);
  }

  @Get('export')
  @ApiOperation({
    summary: 'CSV data export',
    description:
      'Export platform data as CSV. type: transactions | users | ledger | circles. ' +
      'startDate and endDate are required ISO date strings.',
  })
  @ApiProduces('text/csv')
  async exportCsv(@Query() dto: ExportQueryDto, @Res() res: Response) {
    const csv = await this.auditService.exportCsv(dto);
    const filename = `${dto.type}_${dto.startDate}_${dto.endDate}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
