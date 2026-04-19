import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UserStatus } from '@prisma/client';
import { UserFilterDto, UpdateUserStatusDto } from './dto/superadmin.dto';

@Injectable()
export class SuperadminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ── User Directory ───────────────────────────────────────────────────────────

  async listUsers(dto: UserFilterDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (dto.status) where.status = dto.status;
    if (dto.role) where.role = dto.role;
    if (dto.kycStatus) where.kyc = { status: dto.kycStatus };

    if (dto.registeredFrom || dto.registeredTo) {
      where.createdAt = {};
      if (dto.registeredFrom) where.createdAt.gte = new Date(dto.registeredFrom);
      if (dto.registeredTo) where.createdAt.lte = new Date(dto.registeredTo);
    }

    if (dto.search) {
      const term = dto.search.trim();
      where.OR = [
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
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
          suspendedAt: true,
          suspensionReason: true,
          kyc: { select: { status: true, step: true } },
          wallet: { select: { id: true, status: true } },
          _count: {
            select: { roscaMemberships: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── User Detail ──────────────────────────────────────────────────────────────

  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        dob: true,
        gender: true,
        role: true,
        status: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
        suspendedAt: true,
        suspensionReason: true,
        kyc: true,
        profile: true,
        virtualAccount: {
          select: {
            accountNumber: true,
            bankName: true,
            accountName: true,
            isActive: true,
          },
        },
        userTrustStats: true,
        creditScore: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    // Wallet balance from ledger
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        id: true,
        status: true,
        ledgerEntries: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { balanceAfter: true },
        },
      },
    });

    const walletBalance = wallet?.ledgerEntries[0]?.balanceAfter ?? 0n;

    // ROSCA participation
    const memberships = await this.prisma.roscaMembership.findMany({
      where: { userId },
      include: {
        circle: {
          select: {
            id: true,
            name: true,
            status: true,
            contributionAmount: true,
            frequency: true,
            durationCycles: true,
            currentCycle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Recent ledger activity (last 20 entries)
    const recentActivity = await this.prisma.ledgerEntry.findMany({
      where: wallet ? { walletId: wallet.id } : { walletId: 'none' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        entryType: true,
        movementType: true,
        sourceType: true,
        amount: true,
        balanceAfter: true,
        reference: true,
        metadata: true,
        createdAt: true,
      },
    });

    // Outstanding debts
    const debts = await this.prisma.missedContributionDebt.findMany({
      where: { userId, status: { not: 'SETTLED' } },
      select: {
        id: true,
        circleId: true,
        cycleNumber: true,
        missedAmount: true,
        status: true,
      },
    });

    return {
      user,
      wallet: wallet
        ? {
            id: wallet.id,
            status: wallet.status,
            balanceKobo: walletBalance.toString(),
            balanceNaira: (Number(walletBalance) / 100).toFixed(2),
          }
        : null,
      roscaParticipation: memberships.map((m) => ({
        membershipId: m.id,
        membershipStatus: m.status,
        joinedAt: m.createdAt,
        circle: m.circle,
      })),
      recentActivity: recentActivity.map((e) => ({
        ...e,
        amount: e.amount.toString(),
        balanceAfter: e.balanceAfter.toString(),
      })),
      outstandingDebts: debts.map((d) => ({
        ...d,
        missedAmount: d.missedAmount.toString(),
      })),
    };
  }

  // ── Role Promotion ───────────────────────────────────────────────────────────

  async promoteToSuperadmin(actorId: string, userId: string) {
    if (actorId === userId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'SUPERADMIN') {
      throw new BadRequestException('User is already a SUPERADMIN');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'SUPERADMIN' },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'SUPERADMIN',
        action: 'USER_PROMOTED_TO_SUPERADMIN',
        entityType: 'USER',
        entityId: userId,
        metadata: { previousRole: user.role, newRole: 'SUPERADMIN' },
      },
    });

    return updated;
  }

  // ── Admin Request Management ─────────────────────────────────────────────────

  async approveAdminRequest(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (!user.adminRequestedAt) {
      throw new BadRequestException('This user has not submitted an admin access request');
    }

    if (user.role === 'ADMIN' || user.role === 'SUPERADMIN') {
      throw new BadRequestException('User already has elevated role');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'ADMIN', adminRequestedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'SUPERADMIN',
        action: 'ADMIN_REQUEST_APPROVED',
        entityType: 'USER',
        entityId: userId,
        metadata: { previousRole: user.role, newRole: 'ADMIN' },
      },
    });

    return updated;
  }

  async rejectAdminRequest(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (!user.adminRequestedAt) {
      throw new BadRequestException('This user has not submitted an admin access request');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { adminRequestedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'SUPERADMIN',
        action: 'ADMIN_REQUEST_REJECTED',
        entityType: 'USER',
        entityId: userId,
        metadata: {},
      },
    });

    return updated;
  }

  // ── Status Management ────────────────────────────────────────────────────────

  async updateUserStatus(actorId: string, userId: string, dto: UpdateUserStatusDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'SUPERADMIN') {
      throw new BadRequestException('Cannot change status of another SUPERADMIN');
    }

    const updateData: any = { status: dto.status };

    if (dto.status === UserStatus.SUSPENDED || dto.status === UserStatus.BANNED) {
      updateData.suspendedAt = new Date();
      updateData.suspensionReason = dto.reason ?? null;
    } else if (dto.status === UserStatus.ACTIVE) {
      updateData.suspendedAt = null;
      updateData.suspensionReason = null;
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, email: true, status: true, suspendedAt: true, suspensionReason: true },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'SUPERADMIN',
        action: `USER_${dto.status}`,
        entityType: 'USER',
        entityId: userId,
        reason: dto.reason,
        metadata: { previousStatus: user.status, newStatus: dto.status },
      },
    });

    return updated;
  }
}
