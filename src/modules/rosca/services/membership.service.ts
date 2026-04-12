// src/modules/rosca/services/membership.service.ts
import * as crypto from 'crypto';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  Prisma,
  EntryType,
  MovementType,
  BucketType,
  LedgerSourceType,
  CircleStatus,
  MembershipStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../ledger/ledger.service';
import { NotificationService } from '../../notification/notification.service';
import { calculateCollateral } from '../utils/rosca.utils';

@Injectable()
export class MembershipService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private notifications: NotificationService,
  ) {}

  // =========================================================================
  // JOIN / LEAVE
  // =========================================================================

  async requestToJoin(userId: string, circleId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('Wallet not found');

        const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
        if (!circle) throw new NotFoundException('Circle not found');

        if (circle.visibility === 'PRIVATE') {
          throw new BadRequestException(
            'This is a private circle. You must use an invite link to join.',
          );
        }
        if (circle.status !== CircleStatus.DRAFT && circle.status !== CircleStatus.ACTIVE) {
          throw new BadRequestException('Circle not accepting members');
        }
        if (circle.filledSlots >= circle.maxSlots) {
          throw new BadRequestException('Circle is full');
        }

        const existing = await tx.roscaMembership.findUnique({
          where: { circleId_userId: { circleId, userId } },
        });
        if (existing) throw new ConflictException('Already a member or pending approval');

        const membershipId = crypto.randomUUID();
        const collateralAmount = calculateCollateral(circle.contributionAmount);
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

        return await tx.roscaMembership.create({
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async leaveCircle(circleId: string, userId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
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

        await tx.roscaMembership.delete({ where: { id: membership.id } });

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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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

  async getMyRejectedRequests(userId: string) {
    return await this.prisma.roscaMembership.findMany({
      where: { userId, status: MembershipStatus.REJECTED },
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

  // =========================================================================
  // ADMIN: APPROVE / REJECT
  // =========================================================================

  async approveMember(circleId: string, adminId: string, userId: string) {
    const membership = await this.prisma.$transaction(async (tx) => {
      const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
      if (!circle) throw new NotFoundException('Circle not found');
      if (circle.adminId !== adminId) {
        throw new BadRequestException('Only circle admin can approve');
      }

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

    const { user } = membership.membership;
    const fullName = `${user.firstName} ${user.lastName}`;

    // Approval notification (what it means for the member)
    this.notifications
      .sendMemberApprovedNotification(userId, user.email, fullName, membership.circleName, membership.newPosition)
      .catch((err) => console.error('Failed to send member approved notification', err));

    // Payout position assignment (the specific slot detail)
    this.notifications
      .sendPayoutPositionNotification(userId, user.email, fullName, membership.circleName, membership.newPosition, false)
      .catch((err) => console.error('Failed to send payout position notification', err));

    return membership.membership;
  }

  async rejectMember(circleId: string, adminId: string, userId: string) {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const circle = await tx.roscaCircle.findUnique({ where: { id: circleId } });
        if (!circle) throw new NotFoundException('Circle not found');
        if (circle.adminId !== adminId) {
          throw new BadRequestException('Only circle admin can reject members');
        }

        const membership = await tx.roscaMembership.findUnique({
          where: { circleId_userId: { circleId, userId } },
          include: { user: { select: { firstName: true, lastName: true, email: true } } },
        });
        if (!membership) throw new NotFoundException('Membership not found');
        if (membership.status !== MembershipStatus.PENDING) {
          throw new BadRequestException('Only pending memberships can be rejected');
        }

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

        const updated = await tx.roscaMembership.update({
          where: { circleId_userId: { circleId, userId } },
          data: { status: MembershipStatus.REJECTED },
        });

        return { membership: updated, user: membership.user, circleName: circle.name };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Fire rejection notification after transaction commits
    this.notifications
      .sendMemberRejectedNotification(
        userId,
        result.user.email,
        `${result.user.firstName} ${result.user.lastName}`,
        result.circleName,
      )
      .catch((err) => console.error('Failed to send member rejected notification', err));

    return result.membership;
  }
}
