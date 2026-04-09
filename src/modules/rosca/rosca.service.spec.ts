import { Test, TestingModule } from '@nestjs/testing';
import { RoscaService } from './rosca.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import {
  CircleStatus,
  MembershipStatus,
  EntryType,
  MovementType,
  LedgerSourceType,
  BucketType,
} from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('RoscaService', () => {
  let service: RoscaService;

  const mockLedgerService = {
    writeEntry: jest.fn().mockResolvedValue({ id: 'mock-ledger-entry-id' }),
  };

  const mockPrisma: any = {
    roscaCircle: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    roscaMembership: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    roscaContribution: { findUnique: jest.fn(), create: jest.fn() },
    roscaCycleSchedule: { createMany: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    wallet: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  mockPrisma.$transaction = jest.fn().mockImplementation((cb) => cb(mockPrisma));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoscaService,
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: { createInAppNotification: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<RoscaService>(RoscaService);
    jest.clearAllMocks();
  });

  // ── requestToJoin ──────────────────────────────────────────────────────────

  describe('requestToJoin', () => {
    const userId = 'user-1';
    const circleId = 'circle-1';

    const baseCircle = {
      id: circleId,
      status: CircleStatus.DRAFT,
      contributionAmount: 500000n, // ₦5000
      collateralPercentage: 10,
      filledSlots: 3,
      maxSlots: 10,
    };

    it('should reserve 10% collateral on a successful join request', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaCircle.findUnique.mockResolvedValue(baseCircle);
      mockPrisma.roscaMembership.findUnique.mockResolvedValue(null);
      mockPrisma.roscaMembership.create.mockResolvedValue({
        id: 'mem-1', circleId, userId, status: MembershipStatus.PENDING, collateralAmount: 50000n,
      });

      await service.requestToJoin(userId, circleId);

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

      await expect(service.requestToJoin(userId, circleId)).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if circle is full', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaCircle.findUnique.mockResolvedValue({ ...baseCircle, filledSlots: 10 });
      mockPrisma.roscaMembership.findUnique.mockResolvedValue(null);

      await expect(service.requestToJoin(userId, circleId)).rejects.toThrow(BadRequestException);
    });
  });

  // ── rejectMember ───────────────────────────────────────────────────────────

  describe('rejectMember', () => {
    it('should release collateral and set status to REJECTED', async () => {
      const circleId = 'circle-1';
      const adminId = 'admin-1';
      const userId = 'user-1';

      mockPrisma.roscaCircle.findUnique.mockResolvedValue({ id: circleId, adminId });
      mockPrisma.roscaMembership.findUnique.mockResolvedValue({
        id: 'mem-1', status: MembershipStatus.PENDING, collateralAmount: 50000n,
      });
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaMembership.update.mockResolvedValue({ id: 'mem-1', status: MembershipStatus.REJECTED });

      await service.rejectMember(circleId, adminId, userId);

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
        id: 'mem-1', status: MembershipStatus.ACTIVE, collateralAmount: 50000n,
      });

      await expect(service.rejectMember('circle-1', 'admin-1', 'user-1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── calculateCollateral (fixed at 10%) ────────────────────────────────────

  describe('collateral calculation', () => {
    it('should always calculate exactly 10% regardless of circle config', async () => {
      const circleId = 'circle-1';
      mockPrisma.wallet.findUnique.mockResolvedValue({ id: 'wallet-1' });
      mockPrisma.roscaCircle.findUnique.mockResolvedValue({
        id: circleId,
        status: CircleStatus.DRAFT,
        contributionAmount: 1000000n, // ₦10,000
        collateralPercentage: 99, // even if DB has a different value, code ignores it
        filledSlots: 0,
        maxSlots: 10,
      });
      mockPrisma.roscaMembership.findUnique.mockResolvedValue(null);
      mockPrisma.roscaMembership.create.mockResolvedValue({
        id: 'mem-1', collateralAmount: 100000n, status: MembershipStatus.PENDING,
      });

      await service.requestToJoin('user-1', circleId);

      // Must always be 10% = 100000n, never 99%
      expect(mockLedgerService.writeEntry).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100000n }),
        expect.anything(),
      );
    });
  });

  // ── activateCircle ─────────────────────────────────────────────────────────

  describe('activateCircle', () => {
    it('should throw BadRequestException if circle is already active', async () => {
      mockPrisma.roscaCircle.findUnique.mockResolvedValue({
        id: 'circle-1',
        status: CircleStatus.ACTIVE,
        _count: { memberships: 5 },
      });

      const futureDate = new Date(Date.now() + 86400000);
      await expect(service.activateCircle('circle-1', futureDate)).rejects.toThrow(BadRequestException);
    });
  });
});
