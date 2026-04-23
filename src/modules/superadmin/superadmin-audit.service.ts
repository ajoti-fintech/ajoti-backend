import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { LedgerQueryDto, AuditLogQueryDto, ExportQueryDto } from './dto/superadmin.dto';

@Injectable()
export class SuperadminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Global Ledger ────────────────────────────────────────────────────────────

  async getLedgerEntries(dto: LedgerQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (dto.userId) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId: dto.userId },
        select: { id: true },
      });
      where.walletId = wallet?.id ?? 'none';
    }

    if (dto.reference) where.reference = { contains: dto.reference, mode: 'insensitive' };
    if (dto.sourceType) where.sourceType = dto.sourceType;

    if (dto.startDate || dto.endDate) {
      where.createdAt = {};
      if (dto.startDate) where.createdAt.gte = new Date(dto.startDate);
      if (dto.endDate) where.createdAt.lte = new Date(dto.endDate);
    }

    const [entries, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          walletId: true,
          entryType: true,
          movementType: true,
          sourceType: true,
          amount: true,
          balanceAfter: true,
          reference: true,
          metadata: true,
          createdAt: true,
          wallet: {
            select: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
            },
          },
        },
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);

    return {
      data: entries.map((e) => ({
        ...e,
        amount: e.amount.toString(),
        balanceAfter: e.balanceAfter.toString(),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── Audit Log ────────────────────────────────────────────────────────────────

  async getAuditLogs(dto: AuditLogQueryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (dto.actorId) where.actorId = dto.actorId;
    if (dto.entityType) where.entityType = dto.entityType;
    if (dto.action) where.action = { contains: dto.action, mode: 'insensitive' };

    if (dto.startDate || dto.endDate) {
      where.createdAt = {};
      if (dto.startDate) where.createdAt.gte = new Date(dto.startDate);
      if (dto.endDate) where.createdAt.lte = new Date(dto.endDate);
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── CSV Export ───────────────────────────────────────────────────────────────

  async exportCsv(dto: ExportQueryDto): Promise<string> {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    switch (dto.type) {
      case 'transactions':
        return this.exportTransactions(start, end);
      case 'users':
        return this.exportUsers(start, end);
      case 'ledger':
        return this.exportLedger(start, end);
      case 'circles':
        return this.exportCircles(start, end);
    }
  }

  private async exportTransactions(start: Date, end: Date): Promise<string> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        entryType: true,
        movementType: true,
        sourceType: true,
        amount: true,
        reference: true,
        createdAt: true,
        wallet: {
          select: { user: { select: { id: true, email: true } } },
        },
      },
    });

    const header = 'id,userId,email,entryType,movementType,sourceType,amountKobo,reference,createdAt';
    const lines = rows.map((r) =>
      [
        r.id,
        r.wallet?.user?.id ?? '',
        r.wallet?.user?.email ?? '',
        r.entryType,
        r.movementType,
        r.sourceType,
        r.amount.toString(),
        r.reference ?? '',
        r.createdAt.toISOString(),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  private async exportUsers(start: Date, end: Date): Promise<string> {
    const rows = await this.prisma.user.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        isVerified: true,
        createdAt: true,
        kyc: { select: { status: true } },
      },
    });

    const header = 'id,firstName,lastName,email,phone,role,status,isVerified,kycStatus,createdAt';
    const lines = rows.map((r) =>
      [
        r.id,
        r.firstName ?? '',
        r.lastName ?? '',
        r.email,
        r.phone ?? '',
        r.role,
        r.status,
        r.isVerified,
        r.kyc?.status ?? '',
        r.createdAt.toISOString(),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  private async exportLedger(start: Date, end: Date): Promise<string> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        walletId: true,
        entryType: true,
        movementType: true,
        sourceType: true,
        amount: true,
        balanceAfter: true,
        reference: true,
        createdAt: true,
      },
    });

    const header = 'id,walletId,entryType,movementType,sourceType,amountKobo,balanceAfterKobo,reference,createdAt';
    const lines = rows.map((r) =>
      [
        r.id,
        r.walletId ?? '',
        r.entryType,
        r.movementType,
        r.sourceType,
        r.amount.toString(),
        r.balanceAfter.toString(),
        r.reference ?? '',
        r.createdAt.toISOString(),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  private async exportCircles(start: Date, end: Date): Promise<string> {
    const rows = await this.prisma.roscaCircle.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        contributionAmount: true,
        frequency: true,
        durationCycles: true,
        currentCycle: true,
        maxSlots: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    });

    const header = 'id,name,status,contributionAmountKobo,frequency,durationCycles,currentCycle,maxSlots,memberCount,createdAt';
    const lines = rows.map((r) =>
      [
        r.id,
        `"${r.name.replace(/"/g, '""')}"`,
        r.status,
        r.contributionAmount.toString(),
        r.frequency,
        r.durationCycles,
        r.currentCycle,
        r.maxSlots,
        r._count.memberships,
        r.createdAt.toISOString(),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }
}
