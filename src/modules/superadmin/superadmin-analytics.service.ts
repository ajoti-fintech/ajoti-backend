import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { TransactionAnalyticsDto, GrowthMetricsDto } from './dto/superadmin.dto';
import {
  EntryType,
  MovementType,
  LedgerSourceType,
  SystemWalletType,
  CircleStatus,
  KYCStatus,
  UserStatus,
} from '@prisma/client';

@Injectable()
export class SuperadminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Dashboard Snapshot ───────────────────────────────────────────────────────

  async getDashboard() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      bannedUsers,
      newUsersThisWeek,
      totalCircles,
      activeCircles,
      completedCircles,
      cancelledCircles,
      newCirclesThisWeek,
      pendingKyc,
      approvedKyc,
      rejectedKyc,
      outstandingDebts,
      platformPool,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.SUSPENDED } }),
      this.prisma.user.count({ where: { status: UserStatus.BANNED } }),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.roscaCircle.count(),
      this.prisma.roscaCircle.count({ where: { status: CircleStatus.ACTIVE } }),
      this.prisma.roscaCircle.count({ where: { status: CircleStatus.COMPLETED } }),
      this.prisma.roscaCircle.count({ where: { status: CircleStatus.CANCELLED } }),
      this.prisma.roscaCircle.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.kYC.count({ where: { status: KYCStatus.PENDING } }),
      this.prisma.kYC.count({ where: { status: KYCStatus.APPROVED } }),
      this.prisma.kYC.count({ where: { status: KYCStatus.REJECTED } }),
      this.prisma.missedContributionDebt.count({ where: { status: { not: 'SETTLED' } } }),
      this.prisma.systemWallet.findUnique({
        where: { type: SystemWalletType.PLATFORM_POOL },
        include: {
          wallet: {
            include: {
              ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1, select: { balanceAfter: true } },
            },
          },
        },
      }),
    ]);

    // Aggregate all user wallet balances
    const walletAgg = await this.prisma.wallet.aggregate({
      _count: { _all: true },
    });

    // Sum of all latest balances via raw query equivalent
    const balanceResult = await this.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COALESCE(SUM(sub.balance), 0) AS total
      FROM (
        SELECT DISTINCT ON (w.id)
          le."balanceAfter" AS balance
        FROM "Wallet" w
        LEFT JOIN "LedgerEntry" le ON le."walletId" = w.id
        ORDER BY w.id, le."createdAt" DESC
      ) sub
    `;

    const totalUserBalanceKobo = balanceResult[0]?.total ?? 0n;
    const platformPoolBalance =
      platformPool?.wallet?.ledgerEntries[0]?.balanceAfter ?? 0n;

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        banned: bannedUsers,
        newThisWeek: newUsersThisWeek,
      },
      circles: {
        total: totalCircles,
        active: activeCircles,
        completed: completedCircles,
        cancelled: cancelledCircles,
        newThisWeek: newCirclesThisWeek,
      },
      kyc: {
        pending: pendingKyc,
        approved: approvedKyc,
        rejected: rejectedKyc,
      },
      wallet: {
        totalUserBalanceKobo: totalUserBalanceKobo.toString(),
        totalUserBalanceNaira: (Number(totalUserBalanceKobo) / 100).toFixed(2),
        platformPoolKobo: platformPoolBalance.toString(),
        platformPoolNaira: (Number(platformPoolBalance) / 100).toFixed(2),
        totalWallets: walletAgg._count._all,
      },
      defaulters: {
        outstandingDebts,
      },
    };
  }

  // ── Wallet Aggregator ────────────────────────────────────────────────────────

  async getWalletSummary() {
    const [active, frozen, suspended] = await Promise.all([
      this.prisma.wallet.count({ where: { status: 'ACTIVE' } }),
      this.prisma.wallet.count({ where: { status: 'RESTRICTED' } }),
      this.prisma.wallet.count({ where: { status: 'SUSPENDED' } }),
    ]);

    const balanceResult = await this.prisma.$queryRaw<[{ total: bigint }]>`
      SELECT COALESCE(SUM(sub.balance), 0) AS total
      FROM (
        SELECT DISTINCT ON (w.id)
          le."balanceAfter" AS balance
        FROM "Wallet" w
        LEFT JOIN "LedgerEntry" le ON le."walletId" = w.id
        ORDER BY w.id, le."createdAt" DESC
      ) sub
    `;

    const platformPool = await this.prisma.systemWallet.findUnique({
      where: { type: SystemWalletType.PLATFORM_POOL },
      include: {
        wallet: {
          include: {
            ledgerEntries: { orderBy: { createdAt: 'desc' }, take: 1, select: { balanceAfter: true } },
          },
        },
      },
    });

    const totalKobo = balanceResult[0]?.total ?? 0n;
    const poolKobo = platformPool?.wallet?.ledgerEntries[0]?.balanceAfter ?? 0n;

    return {
      totalUserBalanceKobo: totalKobo.toString(),
      totalUserBalanceNaira: (Number(totalKobo) / 100).toFixed(2),
      platformPoolKobo: poolKobo.toString(),
      platformPoolNaira: (Number(poolKobo) / 100).toFixed(2),
      walletCounts: { active, frozen, suspended },
    };
  }

  // ── Inflow / Outflow Analytics ───────────────────────────────────────────────

  async getTransactionAnalytics(dto: TransactionAnalyticsDto) {
    const { start, end } = this.resolveDateRange(dto);

    // Inflow: CREDIT entries from external funding (TRANSACTION source)
    const inflowEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        entryType: EntryType.CREDIT,
        movementType: MovementType.FUNDING,
        sourceType: LedgerSourceType.TRANSACTION,
        createdAt: { gte: start, lte: end },
      },
      select: { amount: true, createdAt: true },
    });

    // Outflow: DEBIT entries from withdrawals
    const outflowEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        entryType: EntryType.DEBIT,
        movementType: MovementType.WITHDRAWAL,
        createdAt: { gte: start, lte: end },
      },
      select: { amount: true, createdAt: true },
    });

    // Platform fee revenue
    const feeEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        sourceType: LedgerSourceType.PLATFORM_FEE,
        createdAt: { gte: start, lte: end },
      },
      select: { amount: true, createdAt: true },
    });

    const bucketByDay = (entries: { amount: bigint; createdAt: Date }[]) => {
      const map: Record<string, bigint> = {};
      for (const e of entries) {
        const day = e.createdAt.toISOString().slice(0, 10);
        map[day] = (map[day] ?? 0n) + e.amount;
      }
      return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amountKobo: amount.toString() }));
    };

    const sumKobo = (entries: { amount: bigint }[]) =>
      entries.reduce((s, e) => s + e.amount, 0n);

    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      inflow: {
        totalKobo: sumKobo(inflowEntries).toString(),
        totalNaira: (Number(sumKobo(inflowEntries)) / 100).toFixed(2),
        count: inflowEntries.length,
        byDay: bucketByDay(inflowEntries),
      },
      outflow: {
        totalKobo: sumKobo(outflowEntries).toString(),
        totalNaira: (Number(sumKobo(outflowEntries)) / 100).toFixed(2),
        count: outflowEntries.length,
        byDay: bucketByDay(outflowEntries),
      },
      platformFees: {
        totalKobo: sumKobo(feeEntries).toString(),
        totalNaira: (Number(sumKobo(feeEntries)) / 100).toFixed(2),
        count: feeEntries.length,
        byDay: bucketByDay(feeEntries),
      },
    };
  }

  // ── Growth Metrics ───────────────────────────────────────────────────────────

  async getGrowthMetrics(dto: GrowthMetricsDto) {
    const days = dto.period === '7d' ? 7 : dto.period === '90d' ? 90 : 30;
    const now = new Date();
    const currentStart = new Date(now.getTime() - days * 86_400_000);
    const previousStart = new Date(currentStart.getTime() - days * 86_400_000);

    const [currentUsers, previousUsers, currentCircles, previousCircles] = await Promise.all([
      this.prisma.user.count({ where: { createdAt: { gte: currentStart } } }),
      this.prisma.user.count({
        where: { createdAt: { gte: previousStart, lt: currentStart } },
      }),
      this.prisma.roscaCircle.count({ where: { createdAt: { gte: currentStart } } }),
      this.prisma.roscaCircle.count({
        where: { createdAt: { gte: previousStart, lt: currentStart } },
      }),
    ]);

    // Daily time series for the current period
    const dailyUsers = await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*) AS count
      FROM "User"
      WHERE "createdAt" >= ${currentStart}
      GROUP BY day ORDER BY day
    `;

    const dailyCircles = await this.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*) AS count
      FROM "RoscaCircle"
      WHERE "createdAt" >= ${currentStart}
      GROUP BY day ORDER BY day
    `;

    const pct = (curr: number, prev: number) =>
      prev === 0 ? null : (((curr - prev) / prev) * 100).toFixed(1);

    return {
      period: `${days}d`,
      users: {
        current: currentUsers,
        previous: previousUsers,
        delta: currentUsers - previousUsers,
        percentChange: pct(currentUsers, previousUsers),
      },
      circles: {
        current: currentCircles,
        previous: previousCircles,
        delta: currentCircles - previousCircles,
        percentChange: pct(currentCircles, previousCircles),
      },
      timeSeries: {
        users: dailyUsers.map((r) => ({
          date: r.day.toISOString().slice(0, 10),
          count: Number(r.count),
        })),
        circles: dailyCircles.map((r) => ({
          date: r.day.toISOString().slice(0, 10),
          count: Number(r.count),
        })),
      },
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private resolveDateRange(dto: TransactionAnalyticsDto): { start: Date; end: Date } {
    const end = new Date();
    if (dto.period === 'custom' && dto.startDate && dto.endDate) {
      return { start: new Date(dto.startDate), end: new Date(dto.endDate) };
    }
    const days = dto.period === '7d' ? 7 : dto.period === '90d' ? 90 : 30;
    return { start: new Date(end.getTime() - days * 86_400_000), end };
  }
}
