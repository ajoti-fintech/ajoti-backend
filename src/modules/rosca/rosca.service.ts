import * as crypto from 'crypto';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import {
  Prisma,
  EntryType,
  MovementType,
  BucketType,
  LedgerSourceType,
  CircleStatus,
  MembershipStatus,
  ScheduleStatus,
  PayoutLogic,
  PayoutStatus,
} from '@prisma/client';
import {
  AdminListCirclesQueryDto,
  CreateRoscaCircleDto,
  ListCirclesQueryDto,
  UpdateCircleDto,
} from './dto/rosca.dto';
import { PayoutSorter } from './payout-sorter.util';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class RoscaService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private notifications: NotificationService,
  ) {}

  // =========================================================================
  // CIRCLE CREATION & ACTIVATION
  // =========================================================================

  async createCircle(adminId: string, data: CreateRoscaCircleDto) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });
    if (!admin) throw new NotFoundException('Admin not found');

    const contributionAmount = this.parseBigInt(data.contributionAmount, 'Contribution Amount');

    return await this.prisma.roscaCircle.create({
      data: {
        ...data,
        contributionAmount,
        adminId,
        status: CircleStatus.DRAFT,
        filledSlots: 0,
      },
      include: {
        admin: {
          select: { firstName: true, lastName: true, email: true },
        },
        memberships: {
          include: {
            user: {
              select: { firstName: true, lastName: true, email: true },
            },
          },
        },
      },
    });
  }

  /**
   * ACTIVATE circle → Generate schedules (R5)
   * Called by admin verification OR autoStartOnFull
   */
  async activateCircle(circleId: string, initialContributionDeadline: Date) {
    const now = new Date();
    const bufferTime = 30 * 60 * 1000; // 30 minutes in milliseconds

    if (initialContributionDeadline.getTime() < now.getTime() - bufferTime) {
      throw new BadRequestException('Initial contribution deadline must not be more than 30 minutes in the past');
    }

    return await this.prisma.$transaction(
      async (tx) => {
        const circle = await tx.roscaCircle.findUnique({
          where: { id: circleId },
          include: { _count: { select: { memberships: true } } },
        });

        if (!circle) throw new NotFoundException('Circle not found');
        if (circle.status !== CircleStatus.DRAFT) {
          throw new BadRequestException('Circle already activated');
        }

        const actualMemberCount = await tx.roscaMembership.count({
          where: { circleId, status: MembershipStatus.ACTIVE },
        });

        if (circle.filledSlots !== actualMemberCount) {
          throw new BadRequestException(
            `Data integrity error: Circle claims ${circle.filledSlots} slots filled, but found ${actualMemberCount} active memberships.`,
          );
        }

        // FIX: removed finalCycleCount (used _count.memberships which includes
        // non-active members). Use actualMemberCount consistently everywhere.
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
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  /**
   * Schedule Generation Engine — Deterministic (R5)
   * Called only at activation, never manually
   */
  private async generateSchedules(tx: Prisma.TransactionClient, circleId: string, initialContributionDeadline: Date) {
    const circle = await tx.roscaCircle.findUnique({
      where: { id: circleId },
    });

    if (!circle) throw new Error('Circle not found');

    const memberships = await tx.roscaMembership.findMany({
      where: { circleId, status: MembershipStatus.ACTIVE },
      include: {
        user: {
          include: { userTrustStats: true },
        },
      },
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

      // Payout occurs 24 hours after the contribution deadline.
      // Contributions within this 24h window are accepted but marked late.
      // Contributions after the payout date are considered missed.
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

      // Advance to the next cycle window only after the schedule entry is built
      currentDate = this.addFrequency(contributionDeadline, circle.frequency);
    }

    await tx.roscaCycleSchedule.createMany({
      data: schedules,
    });

    return schedules;
  }

  /**
   * [Admin] Update Payout Logic or Assign Positions
   * Only allowed while circle is in DRAFT status.
   */
  async updatePayoutConfiguration(
    circleId: string,
    adminId: string,
    dto: { payoutLogic?: PayoutLogic; assignments?: { userId: string; position: number }[] },
  ) {
    // Collect members whose position actually changed so we can notify them after commit
    const reassigned: Array<{ userId: string; email: string; fullName: string; newPosition: number }> = [];

    await this.prisma.$transaction(async (tx) => {
      const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });

      if (!circle) throw new NotFoundException('Circle not found');
      if (circle.adminId !== adminId)
        throw new BadRequestException('Unauthorized: Not the circle admin');
      if (circle.status !== CircleStatus.DRAFT) {
        throw new BadRequestException('Cannot modify payout logic after the circle has started');
      }
      const newLogic = dto.payoutLogic || circle.payoutLogic;

      if (
        newLogic !== PayoutLogic.ADMIN_ASSIGNED &&
        dto.assignments &&
        dto.assignments.length > 0
      ) {
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
        // Load current positions for all affected members before updating
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

        // Detect which positions actually changed
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

    // Send reassignment notifications after the transaction commits (non-blocking)
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
            true, // reassignment
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

  private addFrequency(date: Date, frequency: string): Date {
    const result = new Date(date);
    switch (frequency) {
      case 'WEEKLY':
        result.setDate(result.getDate() + 7);
        break;
      case 'BI_WEEKLY':
        result.setDate(result.getDate() + 14);
        break;
      case 'MONTHLY':
        const originalDay = result.getDate();
        result.setDate(1);
        result.setMonth(result.getMonth() + 1);
        const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
        result.setDate(Math.min(originalDay, lastDay));
        break;
    }
    return result;
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
        admin: {
          select: { firstName: true, lastName: true, email: true },
        },
        _count: {
          select: { memberships: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserParticipations(userId: string) {
    return await this.prisma.roscaCircle.findMany({
      where: {
        memberships: {
          some: { userId },
        },
      },
      include: {
        admin: {
          select: { firstName: true, lastName: true },
        },
        _count: {
          select: { memberships: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getCircle(circleId: string, userId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      include: {
        admin: {
          select: { firstName: true, lastName: true, email: true },
        },
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
        _count: {
          select: { memberships: true },
        },
      },
    });

    if (!circle) throw new NotFoundException('Circle not found');

    // PRIVATE circles are only visible to the admin and existing members
    if (circle.visibility === 'PRIVATE') {
      const isMember = circle.memberships.some((m) => m.userId === userId);
      const isAdmin = circle.adminId === userId;
      if (!isMember && !isAdmin) throw new ForbiddenException('This is a private circle');
    }

    // FIX: use filledSlots (live member count) instead of maxSlots so the pot
    // is not overstated for circles that are not yet full.
    const totalPot = circle.contributionAmount * BigInt(circle.filledSlots);

    const requiredCollateral = this.calculateCollateral(
      circle.contributionAmount,
    );

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
          trustScore: Math.round(300 + raw * 5.5),
        };
      }),
      isRequestingUserAdmin: circle.adminId === userId,
      userMembershipStatus: userMembership?.status || null,
      userPayoutPosition: userMembership?.payoutPosition || null,
    };
  }

  async leaveCircle(circleId: string, userId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const circle = await tx.roscaCircle.findUnique({
          where: { id: circleId },
        });

        if (!circle) throw new NotFoundException('Circle not found');

        if (circle.status !== CircleStatus.DRAFT) {
          throw new BadRequestException('Cannot leave a circle that has already started');
        }

        const membership = await tx.roscaMembership.findUnique({
          where: { circleId_userId: { circleId, userId } },
        });

        if (!membership) throw new NotFoundException('You are not a member of this circle');

        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        // FIX: only write a RELEASE entry if collateral was actually reserved.
        // Avoids a phantom credit if the original RESERVE entry never succeeded.
        if (membership.collateralAmount > 0n) {
          const releaseRef = `COLL-REL-${crypto.randomUUID()}`;

          await this.ledger.writeEntry(
            {
              walletId: wallet.id,
              entryType: EntryType.RELEASE,
              movementType: MovementType.TRANSFER,
              bucketType: BucketType.ROSCA,
              amount: membership.collateralAmount,
              reference: releaseRef,
              sourceType: LedgerSourceType.COLLATERAL_RESERVE,
              sourceId: membership.id,
              metadata: { circleId, action: 'LEAVE_GROUP' },
            },
            tx,
          );
        }

        await tx.roscaMembership.delete({
          where: { id: membership.id },
        });

        if (membership.status === MembershipStatus.ACTIVE) {
          await tx.roscaCircle.update({
            where: { id: circleId },
            data: { filledSlots: { decrement: 1 } },
          });
        }

        const finalCircle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
        if (finalCircle!.filledSlots < 0) {
          throw new Error('Inconsistent state: filledSlots cannot be negative');
        }

        return { success: true, message: 'Successfully left the circle and collateral released' };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async getMyPendingJoinRequests(userId: string) {
    return await this.prisma.roscaMembership.findMany({
      where: { userId, status: MembershipStatus.PENDING },
      include: {
        circle: {
          select: {
            id: true,
            name: true,
            contributionAmount: true,
            frequency: true,
            maxSlots: true,
            filledSlots: true,
            status: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async cancelJoinRequest(userId: string, circleId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const membership = await tx.roscaMembership.findUnique({
          where: { circleId_userId: { circleId, userId } },
        });

        if (!membership) throw new NotFoundException('No join request found for this circle');

        if (membership.status !== MembershipStatus.PENDING) {
          throw new BadRequestException(
            'Only pending join requests can be cancelled. Use the leave endpoint if you are already an active member.',
          );
        }

        if (membership.collateralAmount > 0n) {
          const wallet = await tx.wallet.findUnique({ where: { userId } });
          if (!wallet) throw new NotFoundException('Wallet not found');

          await this.ledger.writeEntry(
            {
              walletId: wallet.id,
              entryType: EntryType.RELEASE,
              movementType: MovementType.TRANSFER,
              bucketType: BucketType.ROSCA,
              amount: membership.collateralAmount,
              reference: `COLL-REL-${crypto.randomUUID()}`,
              sourceType: LedgerSourceType.COLLATERAL_RESERVE,
              sourceId: membership.id,
              metadata: { circleId, action: 'JOIN_REQUEST_CANCELLED' },
            },
            tx,
          );
        }

        await tx.roscaMembership.delete({ where: { id: membership.id } });

        return { success: true, message: 'Join request cancelled and collateral returned' };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getSchedules(circleId: string) {
    return await this.prisma.roscaCycleSchedule.findMany({
      where: {
        circleId,
        obsoletedAt: null,
      },
      orderBy: { cycleNumber: 'asc' },
    });
  }

  // =========================================================================
  // ADMIN RETRIEVAL
  // =========================================================================

  async getCircleByIdForAdmin(circleId: string, adminId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      include: {
        admin: {
          select: { firstName: true, lastName: true, email: true },
        },
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

    if (!circle) {
      throw new NotFoundException('ROSCA circle not found');
    }

    if (circle.adminId !== adminId) {
      throw new ForbiddenException('You do not have permission to view this circle');
    }

    return circle;
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
          contributionAmount: this.parseBigInt(contributionAmount, 'contributionAmount'),
        }),
      },
      include: { admin: true },
    });
  }

  // =========================================================================
  // JOIN REQUEST MANAGEMENT
  // =========================================================================

  /**
   * Returns all circles managed by the admin that have at least one pending
   * join request. Each entry includes the circle id, name, and pending count.
   * Ordered by oldest pending request first (most urgent at top).
   */
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

  /**
   * Returns the full requester dossier for all pending members in a specific
   * circle. Supports optional name search scoped to that circle only.
   */
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
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            userTrustStats: true,
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((m) => {
      const stats = m.user.userTrustStats;
      const displayScore = stats ? Math.round(300 + stats.trustScore * 5.5) : 575;
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
  // ADMIN DASHBOARD
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
        admin: {
          select: { firstName: true, lastName: true, email: true },
        },
        _count: {
          select: { memberships: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateCircleStatus(circleId: string, status: CircleStatus) {
    return await this.prisma.roscaCircle.update({
      where: { id: circleId },
      data: { status },
    });
  }

  // =========================================================================
  // JOIN CIRCLE — COLLATERAL RESERVE
  // =========================================================================

  async requestToJoin(userId: string, circleId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
        if (!circle) throw new NotFoundException('Circle not found');

        if (circle.visibility === 'PRIVATE') {
          throw new BadRequestException('This is a private circle. You must use an invite link to join.');
        }

        if (circle.status !== CircleStatus.DRAFT && circle.status !== CircleStatus.ACTIVE) {
          throw new BadRequestException('Circle not accepting members');
        }
        if (circle.filledSlots >= circle.maxSlots) {
          throw new BadRequestException('Circle is full');
        }

        // FIX: guard against duplicate memberships. Without this a user could
        // call the endpoint twice concurrently and either create two memberships
        // or get an unhandled DB unique-constraint error instead of a clean 409.
        const existing = await tx.roscaMembership.findUnique({
          where: { circleId_userId: { circleId, userId } },
        });
        if (existing) {
          throw new ConflictException('Already a member or pending approval');
        }

        const membershipId = crypto.randomUUID();

        const collateralAmount = this.calculateCollateral(
          circle.contributionAmount,
        );

        const reserveRef = `COLL-RES-${crypto.randomUUID()}`;

        await this.ledger.writeEntry(
          {
            walletId: wallet.id,
            entryType: EntryType.RESERVE,
            movementType: MovementType.TRANSFER,
            bucketType: BucketType.ROSCA,
            amount: collateralAmount,
            reference: reserveRef,
            sourceType: LedgerSourceType.COLLATERAL_RESERVE,
            sourceId: membershipId,
            metadata: { circleId, action: 'JOIN_REQUEST' },
          },
          tx,
        );

        const membership = await tx.roscaMembership.create({
          data: {
            id: membershipId,
            circleId,
            userId,
            status: MembershipStatus.PENDING,
            collateralAmount,
            collateralReleased: false,
            joinedAt: new Date(),
          },
        });

        return membership;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );
  }

  async approveMember(circleId: string, adminId: string, userId: string) {
    const membership = await this.prisma.$transaction(async (tx) => {
      const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
      if (!circle) throw new NotFoundException('Circle not found');

      if (circle.adminId !== adminId) {
        throw new BadRequestException('Only circle admin can approve');
      }

      // Auto-assign last slot: position = filledSlots + 1 (before incrementing)
      const newPosition = circle.filledSlots + 1;

      const updated = await tx.roscaMembership.update({
        where: { circleId_userId: { circleId, userId } },
        data: {
          status: MembershipStatus.ACTIVE,
          approvedAt: new Date(),
          payoutPosition: newPosition,
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
        },
      });

      await tx.roscaCircle.update({
        where: { id: circleId },
        data: { filledSlots: { increment: 1 } },
      });

      return { membership: updated, circleName: circle.name, newPosition };
    });

    // Send initial position notification outside the transaction (non-blocking)
    const { user } = membership.membership;
    this.notifications
      .sendPayoutPositionNotification(
        userId,
        user.email,
        `${user.firstName} ${user.lastName}`,
        membership.circleName,
        membership.newPosition,
        false, // initial assignment, not a reassignment
      )
      .catch((err) =>
        console.error('Failed to send payout position notification', err),
      );

    return membership.membership;
  }

  async rejectMember(circleId: string, adminId: string, userId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
        if (!circle) throw new NotFoundException('Circle not found');

        if (circle.adminId !== adminId) {
          throw new BadRequestException('Only circle admin can reject members');
        }

        const membership = await tx.roscaMembership.findUnique({
          where: { circleId_userId: { circleId, userId } },
        });

        if (!membership) throw new NotFoundException('Membership not found');

        if (membership.status !== MembershipStatus.PENDING) {
          throw new BadRequestException('Only pending memberships can be rejected');
        }

        // Release reserved collateral back to user's wallet
        if (membership.collateralAmount > 0n) {
          const wallet = await tx.wallet.findUnique({ where: { userId } });
          if (!wallet) throw new NotFoundException('Wallet not found');

          const releaseRef = `COLL-REL-${crypto.randomUUID()}`;
          await this.ledger.writeEntry(
            {
              walletId: wallet.id,
              entryType: EntryType.RELEASE,
              movementType: MovementType.TRANSFER,
              bucketType: BucketType.ROSCA,
              amount: membership.collateralAmount,
              reference: releaseRef,
              sourceType: LedgerSourceType.COLLATERAL_RESERVE,
              sourceId: membership.id,
              metadata: { circleId, action: 'MEMBER_REJECTED' },
            },
            tx,
          );
        }

        return await tx.roscaMembership.update({
          where: { circleId_userId: { circleId, userId } },
          data: { status: MembershipStatus.REJECTED },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // =========================================================================
  // ADMIN OVERSIGHT — Member Progress & Payment Visibility
  // =========================================================================

  private async assertAdminOwnsCircle(circleId: string, adminId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: {
        adminId: true,
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
        recipientName: s.recipient ? `${s.recipient.firstName} ${s.recipient.lastName}` : null,
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
        const { collected, count } = totalsMap.get(s.cycleNumber) ?? { collected: 0n, count: 0 };
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

  async notifyMissingMembers(circleId: string, adminId: string, round?: number) {
    const circle = await this.assertAdminOwnsCircle(circleId, adminId);
    const cycleNumber = round ?? circle.currentCycle;

    const [members, contributed] = await Promise.all([
      this.prisma.roscaMembership.findMany({
        where: { circleId, status: MembershipStatus.ACTIVE },
        select: { userId: true },
      }),
      this.prisma.roscaContribution.findMany({
        where: { circleId, cycleNumber },
        select: { userId: true },
      }),
    ]);

    const contributedIds = new Set(contributed.map((c) => c.userId));
    const missingUserIds = members.map((m) => m.userId).filter((id) => !contributedIds.has(id));

    if (missingUserIds.length === 0) {
      return { notified: 0, cycleNumber, message: 'All members have contributed for this cycle' };
    }

    await Promise.allSettled(
      missingUserIds.map((userId) =>
        this.notifications.createInAppNotification(
          userId,
          'Contribution Reminder',
          `You have not yet contributed for cycle ${cycleNumber}. Please contribute before the deadline to avoid a late penalty.`,
        ),
      ),
    );

    return { notified: missingUserIds.length, cycleNumber };
  }

  // =========================================================================
  // INVITE-ONLY GROUPS
  // =========================================================================

  async createInvite(circleId: string, adminId: string, email: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: { adminId: true, visibility: true, status: true, name: true },
    });
    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.adminId !== adminId) throw new ForbiddenException('Only the circle admin can send invites');
    if (circle.visibility !== 'PRIVATE') throw new BadRequestException('Invites can only be sent for PRIVATE circles');
    if (circle.status !== CircleStatus.DRAFT) throw new BadRequestException('Circle is no longer accepting new members');

    // Revoke any existing unused invite for this email+circle before creating a fresh one
    await this.prisma.roscaInvite.deleteMany({
      where: { circleId, email, usedAt: null },
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

    const invite = await this.prisma.roscaInvite.create({
      data: { circleId, email, expiresAt },
    });

    // Notify the invitee if they have an account
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      await this.notifications.createInAppNotification(
        user.id,
        `You've been invited to join ${circle.name}`,
        `You have a private invitation to join the savings group "${circle.name}". Use your invite link before it expires.`,
      ).catch(() => {/* non-critical */});
    }

    return invite;
  }

  async listInvites(circleId: string, adminId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: { adminId: true },
    });
    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.adminId !== adminId) throw new ForbiddenException('Only the circle admin can view invites');

    return this.prisma.roscaInvite.findMany({
      where: { circleId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(circleId: string, inviteId: string, adminId: string) {
    const invite = await this.prisma.roscaInvite.findUnique({
      where: { id: inviteId },
      include: { circle: { select: { adminId: true } } },
    });
    if (!invite || invite.circleId !== circleId) throw new NotFoundException('Invite not found');
    if (invite.circle.adminId !== adminId) throw new ForbiddenException('Only the circle admin can revoke invites');
    if (invite.usedAt) throw new BadRequestException('Cannot revoke an already-used invite');

    await this.prisma.roscaInvite.delete({ where: { id: inviteId } });
    return { message: 'Invite revoked successfully' };
  }

  async joinByInvite(userId: string, token: string) {
    return await this.prisma.$transaction(async (tx) => {
      const invite = await tx.roscaInvite.findUnique({
        where: { token },
        include: { circle: true },
      });

      if (!invite) throw new NotFoundException('Invalid invite token');
      if (invite.usedAt) throw new BadRequestException('This invite has already been used');
      if (invite.expiresAt < new Date()) throw new BadRequestException('This invite has expired');

      // Verify the accepting user's email matches the invite
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) throw new NotFoundException('User not found');
      if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
        throw new ForbiddenException('This invite was sent to a different email address');
      }

      const circle = invite.circle;
      if (circle.status !== CircleStatus.DRAFT) throw new BadRequestException('Circle is no longer accepting members');
      if (circle.filledSlots >= circle.maxSlots) throw new BadRequestException('Circle is full');

      const existing = await tx.roscaMembership.findUnique({
        where: { circleId_userId: { circleId: circle.id, userId } },
      });
      if (existing) throw new ConflictException('Already a member or pending approval');

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

      const membershipId = crypto.randomUUID();
      const collateralAmount = this.calculateCollateral(circle.contributionAmount);
      const reserveRef = `COLL-RES-${crypto.randomUUID()}`;

      await this.ledger.writeEntry(
        {
          walletId: wallet.id,
          entryType: EntryType.RESERVE,
          movementType: MovementType.TRANSFER,
          bucketType: BucketType.ROSCA,
          amount: collateralAmount,
          reference: reserveRef,
          sourceType: LedgerSourceType.COLLATERAL_RESERVE,
          sourceId: membershipId,
          metadata: { circleId: circle.id, action: 'INVITE_JOIN' },
        },
        tx,
      );

      const membership = await tx.roscaMembership.create({
        data: {
          id: membershipId,
          circleId: circle.id,
          userId,
          status: MembershipStatus.PENDING,
          collateralAmount,
          collateralReleased: false,
          joinedAt: new Date(),
        },
      });

      // Mark invite as used
      await tx.roscaInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });

      return membership;
    });
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  // FIX: rewritten to keep all arithmetic in BigInt, avoiding Number precision
  // Collateral is fixed at 10% of the contribution amount platform-wide.
  private calculateCollateral(contributionAmount: bigint): bigint {
    const COLLATERAL_PERCENT = 10;
    return (contributionAmount * BigInt(COLLATERAL_PERCENT)) / 100n;
  }

  // FIX: separated the cast failure from the "must be positive" check so
  // callers get a precise error message for each failure mode.
  private parseBigInt(value: number | string, fieldName: string): bigint {
    let amount: bigint;
    try {
      amount = BigInt(value);
    } catch {
      throw new BadRequestException(`${fieldName} must be a valid integer string (Kobo)`);
    }
    if (amount <= 0n) {
      throw new BadRequestException(`${fieldName} must be greater than zero`);
    }
    return amount;
  }
}
