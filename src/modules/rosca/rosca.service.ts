import * as crypto from 'crypto';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
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
} from '@prisma/client';
import {
  AdminListCirclesQueryDto,
  CreateRoscaCircleDto,
  ListCirclesQueryDto,
} from './dto/rosca.dto';
import { PayoutSorter } from './payout-sorter.util';

@Injectable()
export class RoscaService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  // =========================================================================
  // CIRCLE CREATION & ACTIVATION
  // =========================================================================

  async createCircle(adminId: string, data: CreateRoscaCircleDto) {
    // Validate admin exists
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId },
    });
    if (!admin) throw new NotFoundException('Admin not found');

    let contributionAmount: bigint;

    try {
      contributionAmount = BigInt(data.contributionAmount);
      if (contributionAmount <= 0n) throw new Error();
    } catch {
      throw new BadRequestException('contributionAmount must be a positive integer string');
    }

    // Create circle in DRAFT status
    return await this.prisma.roscaCircle.create({
      data: {
        ...data,
        contributionAmount,
        adminId,
        status: CircleStatus.DRAFT,
        filledSlots: 0,
      },
    });
  }

  /**
   * ACTIVATE circle → Generate schedules (R5)
   * Called by admin verification OR autoStartOnFull
   */
  async activateCircle(circleId: string, startDate: Date) {
    const now = new Date();
    if (startDate < now) {
      throw new BadRequestException('Start date cannot be in the past');
    }
    return await this.prisma.$transaction(
      async (tx) => {
        // Lock circle row
        const circle = await tx.roscaCircle.findUnique({
          where: { id: circleId },
          include: { _count: { select: { memberships: true } } },
        });

        if (!circle) throw new NotFoundException('Circle not found');
        if (circle.status !== CircleStatus.DRAFT) {
          throw new BadRequestException('Circle already activated');
        }

        const finalCycleCount = circle._count.memberships;

        // Update status and start date
        const updated = await tx.roscaCircle.update({
          where: { id: circleId },
          data: {
            status: CircleStatus.ACTIVE,
            startDate,
            verifiedAt: new Date(),
            currentCycle: 1,
            durationCycles: finalCycleCount,
          },
        });

        await this.generateSchedules(tx, circleId, startDate);

        // Audit log
        await tx.auditLog.create({
          data: {
            actorId: 'SYSTEM',
            actorType: 'SYSTEM',
            action: 'CIRCLE_ACTIVATED',
            entityType: 'ROSCA_CIRCLE',
            entityId: circleId,
            before: { status: CircleStatus.DRAFT },
            after: { status: CircleStatus.ACTIVE, startDate },
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
  private async generateSchedules(tx: Prisma.TransactionClient, circleId: string, startDate: Date) {
    const circle = await tx.roscaCircle.findUnique({
      where: { id: circleId },
    });

    if (!circle) throw new Error('Circle not found');

    // 1. Fetch active members with their trust scores
    const memberships = await tx.roscaMembership.findMany({
      where: { circleId, status: MembershipStatus.ACTIVE },
      include: {
        user: {
          include: { userTrustStats: true },
        },
      },
    });

    // 2. Rank members: Trust Score (Desc), then Joined Date (Asc)
    const sortedMembers = PayoutSorter.sort(memberships, circle.payoutLogic);

    for (let i = 0; i < sortedMembers.length; i++) {
      await tx.roscaMembership.update({
        where: { id: sortedMembers[i].id },
        data: { payoutPosition: i + 1 },
      });
    }
    const schedules = [];
    let currentDate = new Date(startDate);

    for (let i = 1; i <= circle.durationCycles; i++) {
      // Contribution deadline = start date + (frequency * (i-1))
      const contributionDeadline = this.addFrequency(currentDate, circle.frequency);

      // Payout date = contribution deadline + 3 days
      const payoutDate = new Date(contributionDeadline);
      payoutDate.setDate(payoutDate.getDate() + 3);

      // 3. Assign recipient deterministically from the sorted list
      // Note: If cycles > members (e.g. multi-slot), this uses modulo
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

      currentDate = contributionDeadline;
    }

    await tx.roscaCycleSchedule.createMany({
      data: schedules,
    });

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
      case 'MONTHLY':
        const originalDay = result.getDate();

        // move to start of month first so changing the month can't overflow
        result.setDate(1);
        result.setMonth(result.getMonth() + 1);

        // find the last valid day in the target month
        const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();

        // clamp
        result.setDate(Math.min(originalDay, lastDay));
        break;
    }
    return result;
  }

  // =========================================================================
  // CIRCLE RETRIEVAL
  // =========================================================================

  /**
   * List circles for members (Publicly visible only)
   */
  async listCircles(query: ListCirclesQueryDto) {
    const { status, name } = query;

    return await this.prisma.roscaCircle.findMany({
      where: {
        visibility: 'PUBLIC',
        status: status || { in: [CircleStatus.DRAFT, CircleStatus.ACTIVE] },
        name: name ? { contains: name, mode: 'insensitive' } : undefined,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get specific circle details
   */
  async getCircle(circleId: string, userId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      include: {
        memberships: {
          where: { userId }, // Check if the requesting user is a member
        },
        _count: {
          select: { memberships: true },
        },
      },
    });

    if (!circle) throw new NotFoundException('Circle not found');
    return circle;
  }

  /**
   * Get payment schedules for a circle
   */
  async getSchedules(circleId: string) {
    return await this.prisma.roscaCycleSchedule.findMany({
      where: {
        circleId,
        obsoletedAt: null, // Only get active schedules (R5 compliance)
      },
      orderBy: { cycleNumber: 'asc' },
    });
  }

  // =========================================================================
  // ADMIN RETRIEVAL
  // =========================================================================

  /**
   * [Admin] List all circles regardless of visibility
   */
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
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * [Admin] Update circle status manually (for cancellations, etc)
   */
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
        // 1. Validation and Locks
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
        if (!circle) throw new NotFoundException('Circle not found');

        if (circle.status !== CircleStatus.DRAFT && circle.status !== CircleStatus.ACTIVE) {
          throw new BadRequestException('Circle not accepting members');
        }
        if (circle.filledSlots >= circle.maxSlots) {
          throw new BadRequestException('Circle is full');
        }

        // 2. Pre-generate Membership ID (Crucial for R0 Append-Only Ledger)
        const membershipId = crypto.randomUUID();

        // 3. Calculate collateral
        const collateralAmount = this.calculateCollateral(
          circle.contributionAmount,
          circle.collateralPercentage,
        );

        // 4. RESERVE collateral
        // Note: LedgerService handles the balance check internally per user's note.
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

        // 5. Create membership (PENDING)
        const membership = await tx.roscaMembership.create({
          data: {
            id: membershipId,
            circleId,
            userId,
            status: MembershipStatus.PENDING,
            collateralAmount,
            collateralReleased: false, // Explicitly false
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
    return await this.prisma.$transaction(async (tx) => {
      // Verify admin owns circle
      const circle = await tx.roscaCircle.findUnique({
        where: { id: circleId },
      });
      if (circle!.adminId !== adminId) {
        throw new BadRequestException('Only circle admin can approve');
      }

      const membership = await tx.roscaMembership.update({
        where: {
          circleId_userId: { circleId, userId },
        },
        data: {
          status: MembershipStatus.ACTIVE,
          approvedAt: new Date(),
        },
      });

      // Note: No need to update ledger/bucket sourceId here.
      // The pre-generated membershipId was already used in requestToJoin RESERVE entry.
      // Ledger remains append-only & consistent (Rule R0).

      // Increment filled slots
      await tx.roscaCircle.update({
        where: { id: circleId },
        data: {
          filledSlots: { increment: 1 },
        },
      });

      return membership;
    });
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  private calculateCollateral(contributionAmount: bigint, percentage: number): bigint {
    return BigInt(Math.floor(Number(contributionAmount) * (percentage / 100)));
  }
}
