import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CircleGovernanceFilterDto, FlagMemberDto } from './dto/superadmin.dto';

@Injectable()
export class SuperadminGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Circle Directory ─────────────────────────────────────────────────────────

  async listCircles(dto: CircleGovernanceFilterDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (dto.status) where.status = dto.status;

    if (dto.search) {
      const term = dto.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { admin: { email: { contains: term, mode: 'insensitive' } } },
        { admin: { firstName: { contains: term, mode: 'insensitive' } } },
        { admin: { lastName: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [circles, total] = await Promise.all([
      this.prisma.roscaCircle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          contributionAmount: true,
          frequency: true,
          durationCycles: true,
          currentCycle: true,
          maxSlots: true,
          filledSlots: true,
          payoutLogic: true,
          createdAt: true,
          admin: { select: { id: true, firstName: true, lastName: true, email: true } },
          _count: { select: { memberships: true, debts: true } },
        },
      }),
      this.prisma.roscaCircle.count({ where }),
    ]);

    return {
      data: circles.map((c) => ({
        ...c,
        contributionAmount: c.contributionAmount.toString(),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── Circle Detail ────────────────────────────────────────────────────────────

  async getCircleDetail(circleId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      include: {
        admin: { select: { id: true, firstName: true, lastName: true, email: true } },
        memberships: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        schedules: { orderBy: { cycleNumber: 'asc' } },
        payouts: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
            schedule: { select: { cycleNumber: true } },
            recipient: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        debts: {
          where: { status: { not: 'SETTLED' } },
          select: {
            id: true,
            userId: true,
            cycleNumber: true,
            missedAmount: true,
            status: true,
          },
        },
      },
    });

    if (!circle) throw new NotFoundException('Circle not found');

    return {
      ...circle,
      contributionAmount: circle.contributionAmount.toString(),
      preStartExitPenalty: circle.preStartExitPenalty?.toString() ?? null,
      memberships: circle.memberships.map((m) => ({
        ...m,
        collateralAmount: m.collateralAmount.toString(),
        totalPenaltiesPaid: m.totalPenaltiesPaid.toString(),
      })),
      payouts: circle.payouts.map((p) => ({
        ...p,
        amount: p.amount.toString(),
      })),
      debts: circle.debts.map((d) => ({
        ...d,
        missedAmount: d.missedAmount.toString(),
      })),
    };
  }

  // ── Cancel Circle ────────────────────────────────────────────────────────────

  async cancelCircle(actorId: string, circleId: string, reason: string) {
    const circle = await this.prisma.roscaCircle.findUnique({ where: { id: circleId } });
    if (!circle) throw new NotFoundException('Circle not found');

    if (circle.status === 'COMPLETED' || circle.status === 'CANCELLED') {
      throw new BadRequestException(`Circle is already ${circle.status.toLowerCase()}`);
    }

    const updated = await this.prisma.roscaCircle.update({
      where: { id: circleId },
      data: { status: 'CANCELLED' },
      select: { id: true, name: true, status: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'SUPERADMIN',
        action: 'CIRCLE_CANCELLED',
        entityType: 'ROSCA_CIRCLE',
        entityId: circleId,
        reason,
        metadata: { previousStatus: circle.status },
      },
    });

    return updated;
  }

  // ── Flag Member ──────────────────────────────────────────────────────────────

  async flagMember(actorId: string, membershipId: string, dto: FlagMemberDto) {
    const membership = await this.prisma.roscaMembership.findUnique({
      where: { id: membershipId },
      select: { id: true, userId: true, circleId: true, status: true },
    });

    if (!membership) throw new NotFoundException('Membership not found');

    if (membership.status === 'DEFAULTED') {
      throw new BadRequestException('Member is already flagged as DEFAULTED');
    }

    const updated = await this.prisma.roscaMembership.update({
      where: { id: membershipId },
      data: {
        status: 'DEFAULTED',
        defaultedAt: new Date(),
        payoutLocked: true,
        circleJoinRestricted: true,
      },
      select: { id: true, userId: true, circleId: true, status: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'SUPERADMIN',
        action: 'MEMBER_FLAGGED_DEFAULTED',
        entityType: 'ROSCA_MEMBERSHIP',
        entityId: membershipId,
        reason: dto.reason,
        metadata: { userId: membership.userId, circleId: membership.circleId, previousStatus: membership.status },
      },
    });

    return updated;
  }

  // ── Defaulters ───────────────────────────────────────────────────────────────

  async getDefaulters(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [debts, total] = await Promise.all([
      this.prisma.missedContributionDebt.findMany({
        where: { status: { not: 'SETTLED' } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          circle: { select: { id: true, name: true, status: true } },
        },
      }),
      this.prisma.missedContributionDebt.count({ where: { status: { not: 'SETTLED' } } }),
    ]);

    return {
      data: debts.map((d) => ({
        ...d,
        missedAmount: d.missedAmount.toString(),
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
