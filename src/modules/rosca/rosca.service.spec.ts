import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CircleService } from './services/circle.service';
import { MembershipService } from './services/membership.service';
import {
  CircleStatus,
  MembershipStatus,
  EntryType,
  MovementType,
  LedgerSourceType,
  BucketType,
} from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

const mockLedgerService = {
  writeEntry: jest.fn().mockResolvedValue({ id: 'mock-ledger-entry-id' }),
};

const mockPrisma: any = {
  roscaCircle: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  roscaMembership: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
  },
  roscaContribution: { findUnique: jest.fn(), create: jest.fn() },
  roscaCycleSchedule: {
    createMany: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  wallet: { findUnique: jest.fn() },
  user: { findUnique: jest.fn() },
  auditLog: { create: jest.fn() },
};
mockPrisma.$transaction = jest.fn().mockImplementation((cb) => cb(mockPrisma));

const mockNotifications = {
  createInAppNotification: jest.fn().mockResolvedValue(undefined),
  sendPayoutPositionNotification: jest.fn().mockResolvedValue(undefined),
  sendContributionReminder: jest.fn().mockResolvedValue(undefined),
};

// ── MembershipService tests ────────────────────────────────────────────────

describe('MembershipService', () => {
  let membershipService: MembershipService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembershipService,
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotifications },
      ],
    }).compile();

    membershipService = module.get<MembershipService>(MembershipService);
    jest.clearAllMocks();
  });

  describe('requestToJoin', () => {
    const userId = 'user-1';
    const circleId = 'circle-1';

    const baseCircle = {
      id: circleId,
      status: CircleStatus.DRAFT,
      contributionAmount: 500000n,
      collateralPercentage: 10,
      filledSlots: 3,
      maxSlots: 10,
      visibility: 'PUBLIC',
    };

    it('should reserve 10% collateral on a successful join request', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaCircle.findUnique.mockResolvedValue(baseCircle);
      mockPrisma.roscaMembership.findUnique.mockResolvedValue(null);
      mockPrisma.roscaMembership.create.mockResolvedValue({
        id: 'mem-1',
        circleId,
        userId,
        status: MembershipStatus.PENDING,
        collateralAmount: 50000n,
      });

      await membershipService.requestToJoin(userId, circleId);

      expect(mockLedgerService.writeEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: EntryType.RESERVE,
          bucketType: BucketType.ROSCA,
          amount: 50000n, // 10% of 500000
          sourceType: LedgerSourceType.COLLATERAL_RESERVE,
        }),
        expect.anything(),
      );
    });

    it('should throw ConflictException if already a member', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaCircle.findUnique.mockResolvedValue(baseCircle);
      mockPrisma.roscaMembership.findUnique.mockResolvedValue({ id: 'existing-mem' });

      await expect(membershipService.requestToJoin(userId, circleId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException if circle is full', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaCircle.findUnique.mockResolvedValue({ ...baseCircle, filledSlots: 10 });
      mockPrisma.roscaMembership.findUnique.mockResolvedValue(null);

      await expect(membershipService.requestToJoin(userId, circleId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rejectMember', () => {
    it('should release collateral and set status to REJECTED', async () => {
      const circleId = 'circle-1';
      const adminId = 'admin-1';
      const userId = 'user-1';

      mockPrisma.roscaCircle.findUnique.mockResolvedValue({ id: circleId, adminId });
      mockPrisma.roscaMembership.findUnique.mockResolvedValue({
        id: 'mem-1',
        status: MembershipStatus.PENDING,
        collateralAmount: 50000n,
      });
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaMembership.update.mockResolvedValue({
        id: 'mem-1',
        status: MembershipStatus.REJECTED,
      });

      await membershipService.rejectMember(circleId, adminId, userId);

      expect(mockLedgerService.writeEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: EntryType.RELEASE,
          bucketType: BucketType.ROSCA,
          amount: 50000n,
          sourceType: LedgerSourceType.COLLATERAL_RESERVE,
        }),
        expect.anything(),
      );
    });

    it('should throw BadRequestException if membership is not PENDING', async () => {
      mockPrisma.roscaCircle.findUnique.mockResolvedValue({ id: 'circle-1', adminId: 'admin-1' });
      mockPrisma.roscaMembership.findUnique.mockResolvedValue({
        id: 'mem-1',
        status: MembershipStatus.ACTIVE,
        collateralAmount: 50000n,
      });

      await expect(
        membershipService.rejectMember('circle-1', 'admin-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('collateral calculation (always 10%)', () => {
    it('should calculate exactly 10% regardless of collateralPercentage on the circle', async () => {
      const circleId = 'circle-1';
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaCircle.findUnique.mockResolvedValue({
        id: circleId,
        status: CircleStatus.DRAFT,
        contributionAmount: 1000000n,
        collateralPercentage: 99, // DB value is irrelevant — code uses fixed 10%
        filledSlots: 0,
        maxSlots: 10,
        visibility: 'PUBLIC',
      });
      mockPrisma.roscaMembership.findUnique.mockResolvedValue(null);
      mockPrisma.roscaMembership.create.mockResolvedValue({
        id: 'mem-1',
        collateralAmount: 100000n,
        status: MembershipStatus.PENDING,
      });

      await membershipService.requestToJoin('user-1', circleId);

      expect(mockLedgerService.writeEntry).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100000n }),
        expect.anything(),
      );
    });
  });
});

// ── CircleService tests ────────────────────────────────────────────────────

describe('CircleService', () => {
  let circleService: CircleService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotifications },
      ],
    }).compile();

    circleService = module.get<CircleService>(CircleService);
    jest.clearAllMocks();
  });

  describe('activateCircle', () => {
    it('should throw BadRequestException if circle is already active', async () => {
      mockPrisma.roscaCircle.findUnique.mockResolvedValue({
        id: 'circle-1',
        status: CircleStatus.ACTIVE,
        _count: { memberships: 5 },
      });

      const futureDate = new Date(Date.now() + 86400000);
      await expect(circleService.activateCircle('circle-1', futureDate)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
