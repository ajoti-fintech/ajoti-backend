// src/modules/rosca/services/circle.service.ts
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  Prisma,
  CircleStatus,
  MembershipStatus,
  ScheduleStatus,
  PayoutLogic,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { PayoutSorter } from '../payout-sorter.util';
import { calculateCollateral, parseBigInt } from '../utils/rosca.utils';
import {
  CreateRoscaCircleDto,
  ListCirclesQueryDto,
  UpdateCircleDto,
  UpdatePayoutConfigDto,
} from '../dto/circle.dto';
import { AdminListCirclesQueryDto } from '../dto/admin.dto';

@Injectable()
export class CircleService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
  ) {}

  // =========================================================================
  // CIRCLE CREATION & ACTIVATION
  // =========================================================================

  async createCircle(adminId: string, data: CreateRoscaCircleDto) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin) throw new NotFoundException('Admin not found');

    const contributionAmount = parseBigInt(data.contributionAmount, 'Contribution Amount');

    return await this.prisma.roscaCircle.create({
      data: {
        ...data,
        contributionAmount,
        adminId,
        status: CircleStatus.DRAFT,
        filledSlots: 0,
      },
      include: {
        admin: { select: { firstName: true, lastName: true, email: true } },
        memberships: {
          include: { user: { select: { firstName: true, lastName: true, email: true } } },
        },
      },
    });
  }

  async activateCircle(circleId: string, initialContributionDeadline: Date) {
    const now = new Date();
    const bufferTime = 30 * 60 * 1000;

    if (initialContributionDeadline.getTime() < now.getTime() - bufferTime) {
      throw new BadRequestException(
        'Initial contribution deadline must not be more than 30 minutes in the past',
      );
    }

    const circle = await this.prisma.$transaction(
      async (tx) => {
        const c = await tx.roscaCircle.findUnique({
          where: { id: circleId },
          include: { _count: { select: { memberships: true } } },
        });

        if (!c) throw new NotFoundException('Circle not found');
        if (c.status !== CircleStatus.DRAFT) {
          throw new BadRequestException('Circle already activated');
        }

        const actualMemberCount = await tx.roscaMembership.count({
          where: { circleId, status: MembershipStatus.ACTIVE },
        });

        if (c.filledSlots !== actualMemberCount) {
          throw new BadRequestException(
            `Data integrity error: Circle claims ${c.filledSlots} slots filled, but found ${actualMemberCount} active memberships.`,
          );
        }

        const updated = await tx.roscaCircle.update({
          where: { id: circleId },
          data: {
            status: CircleStatus.ACTIVE,
            initialContributionDeadline,
            verifiedAt: new Date(),
            currentCycle: 1,
            durationCycles: actualMemberCount,
          },
        });

        await this.generateSchedules(tx, circleId, initialContributionDeadline);

        await tx.auditLog.create({
          data: {
            actorId: 'SYSTEM',
            actorType: 'SYSTEM',
            action: 'CIRCLE_ACTIVATED',
            entityType: 'ROSCA_CIRCLE',
            entityId: circleId,
            before: { status: CircleStatus.DRAFT },
            after: { status: CircleStatus.ACTIVE, initialContributionDeadline },
            metadata: { autoActivation: false },
          },
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Notify all active members that the circle has started (non-blocking)
    this.notifyCircleStarted(circleId, circle.name, initialContributionDeadline, circle.contributionAmount).catch(
      (err) => console.error(`Failed to send circle-started notifications for ${circleId}`, err),
    );

    return circle;
  }

  private async notifyCircleStarted(
    circleId: string,
    circleName: string,
    firstDeadline: Date,
    contributionAmount: bigint,
  ) {
    const members = await this.prisma.roscaMembership.findMany({
      where: { circleId, status: MembershipStatus.ACTIVE },
      select: {
        payoutPosition: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    const deadlineFormatted = new Intl.DateTimeFormat('en-NG', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'Africa/Lagos',
    }).format(firstDeadline);

    const amountNaira = (Number(contributionAmount) / 100).toLocaleString('en-NG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    await Promise.allSettled(
      members.map((m) =>
        this.notifications.sendCircleStartedNotification(
          m.user.id,
          m.user.email,
          `${m.user.firstName} ${m.user.lastName}`,
          circleName,
          deadlineFormatted,
          amountNaira,
          m.payoutPosition ?? 0,
        ),
      ),
    );
  }

  private async generateSchedules(
    tx: Prisma.TransactionClient,
    circleId: string,
    initialContributionDeadline: Date,
  ) {
    const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
    if (!circle) throw new Error('Circle not found');

    const memberships = await tx.roscaMembership.findMany({
      where: { circleId, status: MembershipStatus.ACTIVE },
      include: { user: { include: { userTrustStats: true } } },
    });

    if (circle.payoutLogic === PayoutLogic.ADMIN_ASSIGNED) {
      const unassigned = memberships.some((m) => m.payoutPosition === null);
      if (unassigned) {
        throw new BadRequestException(
          'All members must have an assigned position for ADMIN_ASSIGNED logic',
        );
      }
      const positions = memberships.map((m) => m.payoutPosition);
      const hasDuplicates = new Set(positions).size !== positions.length;
      if (hasDuplicates) {
        throw new BadRequestException('Payout positions must be unique');
      }
    }

    const sortedMembers = PayoutSorter.sort(memberships, circle.payoutLogic);

    await Promise.all(
      sortedMembers.map((member, index) =>
        tx.roscaMembership.update({
          where: { id: member.id },
          data: { payoutPosition: index + 1 },
        }),
      ),
    );

    const schedules = [];
    let currentDate = new Date(initialContributionDeadline);

    for (let i = 1; i <= circle.durationCycles; i++) {
      const contributionDeadline = new Date(currentDate);
      const payoutDate = new Date(contributionDeadline);
      payoutDate.setTime(payoutDate.getTime() + 24 * 60 * 60 * 1000);

      const recipientIndex = (i - 1) % sortedMembers.length;
      const recipientId = sortedMembers[recipientIndex].userId;

      schedules.push({
        circleId,
        cycleNumber: i,
        contributionDeadline,
        payoutDate,
        recipientId,
        status: ScheduleStatus.UPCOMING,
      });

      currentDate = this.addFrequency(contributionDeadline, circle.frequency);
    }

    await tx.roscaCycleSchedule.createMany({ data: schedules });
    return schedules;
  }

  private addFrequency(date: Date, frequency: string): Date {
    const result = new Date(date);
    switch (frequency) {
      case 'WEEKLY':
        result.setDate(result.getDate() + 7);
        break;
      case 'BI_WEEKLY':
        result.setDate(result.getDate() + 14);
        break;
      case 'MONTHLY': {
        const originalDay = result.getDate();
        result.setDate(1);
        result.setMonth(result.getMonth() + 1);
        const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
        result.setDate(Math.min(originalDay, lastDay));
        break;
      }
    }
    return result;
  }

  // =========================================================================
  // PAYOUT CONFIGURATION
  // =========================================================================

  async updatePayoutConfiguration(
    circleId: string,
    adminId: string,
    dto: UpdatePayoutConfigDto,
  ) {
    const reassigned: Array<{
      userId: string;
      email: string;
      fullName: string;
      newPosition: number;
    }> = [];

    await this.prisma.$transaction(async (tx) => {
      const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
      if (!circle) throw new NotFoundException('Circle not found');
      if (circle.adminId !== adminId)
        throw new BadRequestException('Unauthorized: Not the circle admin');
      if (circle.status !== CircleStatus.DRAFT) {
        throw new BadRequestException('Cannot modify payout logic after the circle has started');
      }

      const newLogic = dto.payoutLogic || circle.payoutLogic;
      if (newLogic !== PayoutLogic.ADMIN_ASSIGNED && dto.assignments && dto.assignments.length > 0) {
        throw new BadRequestException(
          'Manual assignments can only be saved when the payout logic is set to ADMIN_ASSIGNED',
        );
      }

      if (dto.payoutLogic) {
        await tx.roscaCircle.update({
          where: { id: circleId },
          data: { payoutLogic: dto.payoutLogic },
        });
      }

      if (dto.assignments && dto.assignments.length > 0) {
        const userIds = dto.assignments.map((a) => a.userId);
        const current = await tx.roscaMembership.findMany({
          where: { circleId, userId: { in: userIds } },
          select: {
            userId: true,
            payoutPosition: true,
            user: { select: { firstName: true, lastName: true, email: true } },
          },
        });
        const currentMap = new Map(current.map((m) => [m.userId, m]));

        await Promise.all(
          dto.assignments.map((asn) =>
            tx.roscaMembership.update({
              where: { circleId_userId: { circleId, userId: asn.userId } },
              data: { payoutPosition: asn.position },
            }),
          ),
        );

        for (const asn of dto.assignments) {
          const before = currentMap.get(asn.userId);
          if (before && before.payoutPosition !== asn.position) {
            reassigned.push({
              userId: asn.userId,
              email: before.user.email,
              fullName: `${before.user.firstName} ${before.user.lastName}`,
              newPosition: asn.position,
            });
          }
        }
      }
    });

    if (reassigned.length > 0) {
      const circle = await this.prisma.roscaCircle.findUnique({
        where: { id: circleId },
        select: { name: true },
      });
      const circleName = circle?.name ?? 'your circle';

      for (const member of reassigned) {
        this.notifications
          .sendPayoutPositionNotification(
            member.userId,
            member.email,
            member.fullName,
            circleName,
            member.newPosition,
            true,
          )
          .catch((err) =>
            console.error(`Failed to send reassignment notification to ${member.userId}`, err),
          );
      }
    }

    return { success: true, message: 'Payout configuration updated successfully' };
  }

  async getPayoutConfiguration(circleId: string, adminId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      include: {
        memberships: {
          where: { status: MembershipStatus.ACTIVE },
          select: {
            userId: true,
            payoutPosition: true,
            user: { select: { firstName: true, lastName: true } },
          },
          orderBy: { payoutPosition: 'asc' },
        },
      },
    });

    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.adminId !== adminId)
      throw new ForbiddenException('Only the circle admin can view payout configuration');

    const assignments = circle.memberships.map((m) => ({
      userId: m.userId,
      name: `${m.user.firstName} ${m.user.lastName}`,
      position: m.payoutPosition,
    }));

    const allAssigned = assignments.every((a) => a.position !== null);
    return { payoutLogic: circle.payoutLogic, allAssigned, assignments };
  }

  // =========================================================================
  // CIRCLE RETRIEVAL
  // =========================================================================

  async listCircles(query: ListCirclesQueryDto) {
    const { status, name } = query;
    return await this.prisma.roscaCircle.findMany({
      where: {
        visibility: 'PUBLIC',
        status: status || { in: [CircleStatus.DRAFT, CircleStatus.ACTIVE] },
        name: name ? { contains: name, mode: 'insensitive' } : undefined,
      },
      include: {
        admin: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserParticipations(userId: string) {
    return await this.prisma.roscaCircle.findMany({
      where: {
        memberships: {
          some: { userId, status: { in: [MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] } },
        },
      },
      include: {
        admin: { select: { firstName: true, lastName: true, email: true } },
        memberships: {
          where: { status: { in: [MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] } },
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                userTrustStats: { select: { trustScore: true } },
              },
            },
          },
          orderBy: { payoutPosition: 'asc' },
        },
        _count: { select: { memberships: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getCircle(circleId: string, userId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      include: {
        admin: { select: { firstName: true, lastName: true, email: true } },
        memberships: {
          where: { status: { in: [MembershipStatus.PENDING, MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] } },
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                userTrustStats: { select: { trustScore: true } },
              },
            },
          },
          orderBy: { payoutPosition: 'asc' },
        },
        _count: { select: { memberships: true } },
      },
    });

    if (!circle) throw new NotFoundException('Circle not found');

    if (circle.visibility === 'PRIVATE') {
      const isMember = circle.memberships.some((m) => m.userId === userId);
      const isAdmin = circle.adminId === userId;
      if (!isMember && !isAdmin) throw new ForbiddenException('This is a private circle');
    }

    const totalPot = circle.contributionAmount * BigInt(circle.filledSlots);
    const requiredCollateral = calculateCollateral(circle.contributionAmount);
    const userMembership = circle.memberships.find((m) => m.userId === userId);

    return {
      id: circle.id,
      name: circle.name,
      description: circle.description,
      status: circle.status,
      visibility: circle.visibility,
      contributionAmount: circle.contributionAmount.toString(),
      totalPot: totalPot.toString(),
      frequency: circle.frequency,
      durationCycles: circle.durationCycles,
      collateralPercentage: circle.collateralPercentage,
      requiredCollateral: requiredCollateral.toString(),
      payoutLogic: circle.payoutLogic,
      maxSlots: circle.maxSlots,
      filledSlots: circle.filledSlots,
      availableSlots: circle.maxSlots - circle.filledSlots,
      admin: circle.admin,
      members: circle.memberships.map((m) => {
        const raw = m.user.userTrustStats?.trustScore ?? 50;
        return {
          userId: m.userId,
          name: `${m.user.firstName} ${m.user.lastName}`,
          status: m.status,
          position: m.payoutPosition,
          joinedAt: m.joinedAt,
          trustScore: Math.round(raw),
        };
      }),
      isRequestingUserAdmin: circle.adminId === userId,
      userMembershipStatus: userMembership?.status || null,
      userPayoutPosition: userMembership?.payoutPosition || null,
    };
  }

  async getCircleByIdForAdmin(circleId: string, adminId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      include: {
        admin: { select: { firstName: true, lastName: true, email: true } },
        memberships: {
          where: { status: { in: [MembershipStatus.ACTIVE, MembershipStatus.COMPLETED] } },
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                userTrustStats: { select: { trustScore: true } },
              },
            },
          },
        },
      },
    });

    if (!circle) throw new NotFoundException('ROSCA circle not found');
    if (circle.adminId !== adminId)
      throw new ForbiddenException('You do not have permission to view this circle');

    return circle;
  }

  async getSchedules(circleId: string) {
    return await this.prisma.roscaCycleSchedule.findMany({
      where: { circleId, obsoletedAt: null },
      orderBy: { cycleNumber: 'asc' },
    });
  }

  async updateCircle(circleId: string, userId: string, updateDto: UpdateCircleDto) {
    const circle = await this.prisma.roscaCircle.findFirst({
      where: { id: circleId, adminId: userId },
    });

    if (!circle) throw new NotFoundException('Circle not found or not authorized');
    if (circle.status !== CircleStatus.DRAFT) {
      throw new BadRequestException('Cannot edit a circle once the cycle has officially started');
    }
    if (updateDto.maxSlots && updateDto.maxSlots < circle.filledSlots) {
      throw new BadRequestException('New slot limit cannot be less than current members');
    }

    const { contributionAmount, ...rest } = updateDto;

    return this.prisma.roscaCircle.update({
      where: { id: circleId },
      data: {
        ...rest,
        ...(contributionAmount && {
          contributionAmount: parseBigInt(contributionAmount, 'contributionAmount'),
        }),
      },
      include: { admin: true },
    });
  }

  async updateCircleStatus(circleId: string, status: CircleStatus) {
    return await this.prisma.roscaCircle.update({
      where: { id: circleId },
      data: { status },
    });
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
}
