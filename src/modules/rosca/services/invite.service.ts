// src/modules/rosca/services/invite.service.ts
import * as crypto from 'crypto';
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import {
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
import { MailQueue } from '../../mail/mail.queue';
import { roscaInviteEmailTemplate } from '../../mail/templates/rosca-invite';

const FRONTEND_URL = 'https://user.ajoti.com';
import { calculateCollateral } from '../utils/rosca.utils';

@Injectable()
export class InviteService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private notifications: NotificationService,
    private mailQueue: MailQueue,
  ) {}

  async createInvite(circleId: string, adminId: string, email: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: {
        adminId: true,
        visibility: true,
        status: true,
        name: true,
        contributionAmount: true,
        frequency: true,
        durationCycles: true,
        admin: { select: { firstName: true, lastName: true } },
      },
    });
    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.adminId !== adminId)
      throw new ForbiddenException('Only the circle admin can send invites');
    if (circle.status !== CircleStatus.DRAFT)
      throw new BadRequestException('Circle is no longer accepting new members');

    // Revoke any existing unused invite for this email+circle before creating a fresh one
    await this.prisma.roscaInvite.deleteMany({
      where: { circleId, email, usedAt: null },
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invite = await this.prisma.roscaInvite.create({
      data: { circleId, email, expiresAt },
    });

    const adminName = `${circle.admin.firstName} ${circle.admin.lastName}`.trim();
    const acceptUrl = `${FRONTEND_URL}/rosca/invite/${invite.token}`;

    // In-app notification if user already has an account
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, firstName: true },
    });
    if (user) {
      this.notifications
        .createInAppNotification(
          user.id,
          `You've been invited to join ${circle.name}`,
          `You have a private invitation to join the savings group "${circle.name}". Tap to accept before it expires.`,
          `/rosca/invite/${invite.token}`,
        )
        .catch(() => {});
    }

    // Always send invite email regardless of whether user has an account
    const html = roscaInviteEmailTemplate({
      inviteeName: user?.firstName ?? null,
      adminName,
      circleName: circle.name,
      contributionAmount: Number(circle.contributionAmount),
      frequency: circle.frequency,
      durationCycles: circle.durationCycles ?? 0,
      acceptUrl,
      expiresAt,
    });

    this.mailQueue
      .enqueue(email, `You've been invited to join ${circle.name} on Ajoti`, html)
      .catch(() => {});

    return invite;
  }

  async getInvitePreview(token: string) {
    const invite = await this.prisma.roscaInvite.findUnique({
      where: { token },
      include: {
        circle: {
          select: {
            name: true,
            contributionAmount: true,
            frequency: true,
            durationCycles: true,
            maxSlots: true,
            filledSlots: true,
            admin: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (!invite) throw new NotFoundException('Invalid invite token');

    return {
      token: invite.token,
      email: invite.email,
      expiresAt: invite.expiresAt,
      usedAt: invite.usedAt,
      circle: {
        name: invite.circle.name,
        contributionAmount: invite.circle.contributionAmount.toString(),
        frequency: invite.circle.frequency,
        durationCycles: invite.circle.durationCycles,
        maxSlots: invite.circle.maxSlots,
        filledSlots: invite.circle.filledSlots,
        adminName: `${invite.circle.admin.firstName} ${invite.circle.admin.lastName}`.trim(),
      },
    };
  }

  async listInvites(circleId: string, adminId: string) {
    const circle = await this.prisma.roscaCircle.findUnique({
      where: { id: circleId },
      select: { adminId: true },
    });
    if (!circle) throw new NotFoundException('Circle not found');
    if (circle.adminId !== adminId)
      throw new ForbiddenException('Only the circle admin can view invites');

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
    if (invite.circle.adminId !== adminId)
      throw new ForbiddenException('Only the circle admin can revoke invites');
    if (invite.usedAt) throw new BadRequestException('Cannot revoke an already-used invite');

    await this.prisma.roscaInvite.delete({ where: { id: inviteId } });
    return { message: 'Invite revoked successfully' };
  }

  async getMyInvites(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return [];

    return this.prisma.roscaInvite.findMany({
      where: {
        email: user.email,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        circle: {
          select: {
            id: true,
            name: true,
            contributionAmount: true,
            frequency: true,
            durationCycles: true,
            maxSlots: true,
            filledSlots: true,
            admin: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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

      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) throw new NotFoundException('User not found');
      if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
        throw new ForbiddenException('This invite was sent to a different email address');
      }

      const circle = invite.circle;
      if (circle.status !== CircleStatus.DRAFT)
        throw new BadRequestException('Circle is no longer accepting members');
      if (circle.filledSlots >= circle.maxSlots)
        throw new BadRequestException('Circle is full');

      const existing = await tx.roscaMembership.findUnique({
        where: { circleId_userId: { circleId: circle.id, userId } },
      });
      if (existing) throw new ConflictException('Already a member or pending approval');

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('Wallet not found');

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
          metadata: { circleId: circle.id, action: 'INVITE_JOIN' },
        },
        tx,
      );

      const newPosition = circle.filledSlots + 1;

      const membership = await tx.roscaMembership.create({
        data: {
          id: membershipId,
          circleId: circle.id,
          userId,
          status: MembershipStatus.ACTIVE,
          approvedAt: new Date(),
          payoutPosition: newPosition,
          collateralAmount,
          collateralReleased: false,
          joinedAt: new Date(),
        },
      });

      await tx.roscaCircle.update({
        where: { id: circle.id },
        data: { filledSlots: { increment: 1 } },
      });

      await tx.roscaInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });

      return membership;
    });
  }
}
