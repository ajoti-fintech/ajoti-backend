// src/modules/rosca/services/admin-oversight.service.ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MembershipStatus, PayoutStatus, ScheduleStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../ledger/ledger.service';
import { NotificationService } from '../../notification/notification.service';
import { AdminListCirclesQueryDto } from '../dto/admin.dto';

@Injectable()
export class AdminOversightService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private notifications: NotificationService,
  ) {}

  // =========================================================================
  // SHARED PRIVATE HELPER
  // =========================================================================

  private async assertAdminOwnsCircle(circleId: string, adminId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: {
        adminId: true,
        name: true,
        currentCycle: true,
        durationCycles: true,
        contributionAmount: true,
        filledSlots: true,
      },
    });
    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.adminId !== adminId)
      throw new ForbiddenException('You do not have permission to manage this circle');
    return circle;
  }

  // =========================================================================
  // DASHBOARD & CIRCLE LISTING
  // =========================================================================

  async getAdminDashboard(adminId: string) {
    const now = new Date();

    const [circles, nextSchedule] = await Promise.all([
      this.prisma.roscaCircle.findMany({
        where: { adminId },
        select: {
          id: true,
          name: true,
          memberships: {
            where: { status: MembershipStatus.PENDING },
            select: { id: true },
          },
        },
      }),
      this.prisma.roscaCycleSchedule.findFirst({
        where: {
          circle: { adminId },
          status: ScheduleStatus.UPCOMING,
          contributionDeadline: { gte: now },
          obsoletedAt: null,
        },
        orderBy: { contributionDeadline: 'asc' },
        select: {
          contributionDeadline: true,
          circle: { select: { name: true } },
        },
      }),
    ]);

    const totalPendingRequests = circles.reduce((sum, c) => sum + c.memberships.length, 0);

    return {
      totalGroups: circles.length,
      nextDeadline: nextSchedule
        ? { groupName: nextSchedule.circle.name, deadline: nextSchedule.contributionDeadline }
        : null,
      pendingJoinRequests: {
        total: totalPendingRequests,
        breakdown: circles
          .filter((c) => c.memberships.length > 0)
          .map((c) => ({ groupName: c.name, pendingCount: c.memberships.length })),
      },
    };
  }

  async adminListAllCircles(query: AdminListCirclesQueryDto) {
    const { status, adminId } = query;
    return await this.prisma.roscaCircle.findMany({
      where: {
        status: status || undefined,
        adminId: adminId || undefined,
      },
      include: {
        admin: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // =========================================================================
  // JOIN REQUEST MANAGEMENT
  // =========================================================================

  async getPendingJoinRequestsOverview(adminId: string) {
    const circles = await this.prisma.roscaCircle.findMany({
      where: {
        adminId,
        memberships: { some: { status: MembershipStatus.PENDING } },
      },
      select: {
        id: true,
        name: true,
        memberships: {
          where: { status: MembershipStatus.PENDING },
          select: { joinedAt: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    return circles
      .map((c) => ({
        circleId: c.id,
        name: c.name,
        pendingCount: c.memberships.length,
        oldestRequestAt: c.memberships[0]?.joinedAt ?? null,
      }))
      .sort((a, b) => {
        if (!a.oldestRequestAt) return 1;
        if (!b.oldestRequestAt) return -1;
        return a.oldestRequestAt.getTime() - b.oldestRequestAt.getTime();
      });
  }

  async getCircleJoinRequests(circleId: string, adminId: string, search?: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: { adminId: true },
    });
    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.adminId !== adminId)
      throw new ForbiddenException('Not authorized to manage this circle');

    const memberships = await this.prisma.roscaMembership.findMany({
      where: {
        circleId,
        status: MembershipStatus.PENDING,
        ...(search && {
          user: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
            ],
          },
        }),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, userTrustStats: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((m) => {
      const stats = m.user.userTrustStats;
      const displayScore = stats ? Math.round(stats.trustScore) : 50;
      const onTimeRate =
        stats && stats.totalExpectedPayments > 0
          ? Math.round((stats.totalOnTimePayments / stats.totalExpectedPayments) * 100)
          : null;

      return {
        userId: m.userId,
        membershipId: m.id,
        name: `${m.user.firstName} ${m.user.lastName}`,
        requestedAt: m.joinedAt,
        trustScore: displayScore,
        onTimePaymentRate: onTimeRate,
        completedCycles: m.completedCycles,
      };
    });
  }

  // =========================================================================
  // MEMBER PROGRESS & PAYMENT VISIBILITY
  // =========================================================================

  async getMemberProgress(circleId: string, adminId: string) {
    const circle = await this.assertAdminOwnsCircle(circleId, adminId);

    const [memberships, completedPayouts] = await Promise.all([
      this.prisma.roscaMembership.findMany({
        where: { circleId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] } },
        include: { user: { select: { firstName: true, lastName: true } } },
        orderBy: { payoutPosition: 'asc' },
      }),
      this.prisma.roscaPayout.findMany({
        where: { circleId, status: PayoutStatus.COMPLETED },
        select: { recipientId: true },
      }),
    ]);

    const paidRecipientIds = new Set(completedPayouts.map((p) => p.recipientId));

    return {
      circleId,
      durationCycles: circle.durationCycles,
      members: memberships.map((m) => ({
        userId: m.userId,
        name: `${m.user.firstName} ${m.user.lastName}`,
        completedCycles: m.completedCycles,
        durationCycles: circle.durationCycles,
        payoutStatus: paidRecipientIds.has(m.userId) ? 'PAID' : 'UPCOMING',
        payoutPosition: m.payoutPosition,
        totalLatePayments: m.totalLatePayments,
      })),
    };
  }

  async getContributionsIn(circleId: string, adminId: string, round?: number) {
    const circle = await this.assertAdminOwnsCircle(circleId, adminId);
    const cycleNumber = round ?? circle.currentCycle;

    const contributions = await this.prisma.roscaContribution.findMany({
      where: { circleId, cycleNumber },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { paidAt: 'asc' },
    });

    const totalCollected = contributions.reduce((sum, c) => sum + c.amount, 0n);
    const totalPenalties = contributions.reduce((sum, c) => sum + c.penaltyAmount, 0n);

    return {
      circleId,
      cycleNumber,
      contributions: contributions.map((c) => ({
        contributionId: c.id,
        userId: c.userId,
        memberName: `${c.user.firstName} ${c.user.lastName}`,
        amount: c.amount.toString(),
        penaltyAmount: c.penaltyAmount.toString(),
        isLate: c.penaltyAmount > 0n,
        paidAt: c.paidAt,
      })),
      totalCollected: totalCollected.toString(),
      totalPenalties: totalPenalties.toString(),
    };
  }

  async getAllContributions(circleId: string, adminId: string) {
    await this.assertAdminOwnsCircle(circleId, adminId);

    const contributions = await this.prisma.roscaContribution.findMany({
      where: { circleId },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ cycleNumber: 'asc' }, { paidAt: 'asc' }],
    });

    return contributions.map((c) => ({
      contributionId: c.id,
      userId: c.userId,
      memberName: `${c.user.firstName} ${c.user.lastName}`,
      cycleNumber: c.cycleNumber,
      amount: c.amount.toString(),
      penaltyAmount: c.penaltyAmount.toString(),
      isLate: c.penaltyAmount > 0n,
      paidAt: c.paidAt,
    }));
  }

  async getDisbursementSchedule(circleId: string, adminId: string) {
    await this.assertAdminOwnsCircle(circleId, adminId);

    const schedules = await this.prisma.roscaCycleSchedule.findMany({
      where: { circleId, obsoletedAt: null },
      include: {
        recipient: { select: { id: true, firstName: true, lastName: true } },
        payout: { select: { status: true, amount: true, processedAt: true } },
      },
      orderBy: { cycleNumber: 'asc' },
    });

    return {
      circleId,
      schedules: schedules.map((s) => ({
        cycleNumber: s.cycleNumber,
        recipientId: s.recipientId,
        recipientName: s.recipient
          ? `${s.recipient.firstName} ${s.recipient.lastName}`
          : null,
        payoutDate: s.payoutDate,
        contributionDeadline: s.contributionDeadline,
        scheduleStatus: s.status,
        payoutStatus: s.payout?.status ?? null,
        amountPaidOut: s.payout?.amount?.toString() ?? null,
        processedAt: s.payout?.processedAt ?? null,
      })),
    };
  }

  async getFinancialHealth(circleId: string, adminId: string) {
    const circle = await this.assertAdminOwnsCircle(circleId, adminId);

    const [schedules, contributionTotals] = await Promise.all([
      this.prisma.roscaCycleSchedule.findMany({
        where: { circleId, obsoletedAt: null },
        select: { cycleNumber: true, contributionDeadline: true, status: true },
        orderBy: { cycleNumber: 'asc' },
      }),
      this.prisma.roscaContribution.groupBy({
        by: ['cycleNumber'],
        where: { circleId },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const totalsMap = new Map(
      contributionTotals.map((t) => [
        t.cycleNumber,
        { collected: t._sum.amount ?? 0n, count: t._count.id },
      ]),
    );

    const expectedPot = circle.contributionAmount * BigInt(circle.filledSlots);

    return {
      circleId,
      contributionAmount: circle.contributionAmount.toString(),
      filledSlots: circle.filledSlots,
      cycles: schedules.map((s) => {
        const { collected, count } = totalsMap.get(s.cycleNumber) ?? {
          collected: 0n,
          count: 0,
        };
        const outstanding = expectedPot > collected ? expectedPot - collected : 0n;
        return {
          cycleNumber: s.cycleNumber,
          contributionDeadline: s.contributionDeadline,
          scheduleStatus: s.status,
          expectedPot: expectedPot.toString(),
          collected: collected.toString(),
          outstanding: outstanding.toString(),
          expectedCount: circle.filledSlots,
          collectedCount: count,
        };
      }),
    };
  }

  async notifyMissingMembers(
    circleId: string,
    adminId: string,
    round?: number,
    customMessage?: string,
    memberIds?: string[],
  ) {
    const circle = await this.assertAdminOwnsCircle(circleId, adminId);
    const cycleNumber = round ?? circle.currentCycle;

    const [allMembers, contributed, schedule] = await Promise.all([
      this.prisma.roscaMembership.findMany({
        where: { circleId, status: MembershipStatus.ACTIVE },
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.roscaContribution.findMany({
        where: { circleId, cycleNumber },
        select: { userId: true },
      }),
      this.prisma.roscaCycleSchedule.findFirst({
        where: { circleId, cycleNumber, obsoletedAt: null },
        select: { contributionDeadline: true },
      }),
    ]);

    // If specific memberIds provided, send to those regardless of contribution status
    // Otherwise, send only to members who haven't contributed
    let targets = allMembers;
    if (memberIds && memberIds.length > 0) {
      const idSet = new Set(memberIds);
      targets = allMembers.filter((m) => idSet.has(m.userId));
    } else {
      const contributedIds = new Set(contributed.map((c) => c.userId));
      targets = allMembers.filter((m) => !contributedIds.has(m.userId));
    }

    if (targets.length === 0) {
      return {
        notified: 0,
        cycleNumber,
        message: 'No members to notify',
      };
    }

    if (customMessage) {
      await Promise.allSettled(
        targets.map((m) =>
          this.notifications.sendAdminReminder(
            m.userId,
            m.user.email,
            `${m.user.firstName} ${m.user.lastName}`,
            circle.name,
            customMessage,
          ),
        ),
      );
    } else {
      const amountNaira = (Number(circle.contributionAmount) / 100).toLocaleString('en-NG', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      const deadline = schedule?.contributionDeadline
        ? new Intl.DateTimeFormat('en-NG', {
            dateStyle: 'full',
            timeStyle: 'short',
            timeZone: 'Africa/Lagos',
          }).format(schedule.contributionDeadline)
        : 'soon';

      await Promise.allSettled(
        targets.map((m) =>
          this.notifications.sendContributionReminder(
            m.userId,
            m.user.email,
            `${m.user.firstName} ${m.user.lastName}`,
            circle.name,
            cycleNumber,
            amountNaira,
            deadline,
          ),
        ),
      );
    }

    return { notified: targets.length, cycleNumber };
  }

  // =========================================================================
  // TOP-UP REMINDER
  // =========================================================================

  /**
   * Notifies active members whose available wallet balance is below the circle's
   * contribution amount, prompting them to top up before the next deadline.
   */
  async notifyLowBalanceMembers(circleId: string, adminId: string) {
    const circle = await this.assertAdminOwnsCircle(circleId, adminId);

    const members = await this.prisma.roscaMembership.findMany({
      where: { circleId, status: MembershipStatus.ACTIVE },
      select: {
        userId: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            wallet: { select: { id: true } },
          },
        },
      },
    });

    const requiredKobo = circle.contributionAmount;
    const requiredNaira = (Number(requiredKobo) / 100).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    // Check balances in parallel, notify only those below the threshold
    const checks = await Promise.allSettled(
      members.map(async (m) => {
        const walletId = m.user.wallet?.id;
        if (!walletId) return null;

        const balance = await this.ledger.getDetailedBalance(walletId);
        if (balance.available < requiredKobo) {
          const availableNaira = (Number(balance.available) / 100).toLocaleString('en-NG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          await this.notifications.sendTopUpReminderNotification(
            m.userId,
            m.user.email,
            `${m.user.firstName} ${m.user.lastName}`,
            circle.name,
            requiredNaira,
            availableNaira,
          );
          return m.userId;
        }
        return null;
      }),
    );

    const notified = checks.filter(
      (r) => r.status === 'fulfilled' && r.value !== null,
    ).length;

    return { notified, total: members.length };
  }
}
