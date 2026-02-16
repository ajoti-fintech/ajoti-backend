import { Test, TestingModule } from '@nestjs/testing';
import { RoscaService } from './rosca.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CircleStatus,
  MembershipStatus,
  SystemWalletType,
  EntryType,
  MovementType,
  LedgerSourceType,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('RoscaService', () => {
  let service: RoscaService;
  let ledgerService: LedgerService;
  let prisma: PrismaService;

  const mockUserId = 'user-uuid';
  const mockCircleId = 'circle-uuid';
  const mockWalletId = 'wallet-uuid';
  const mockPoolWalletId = 'pool-wallet-uuid';

  const mockLedgerService = {
    writeEntry: jest.fn().mockResolvedValue({ id: 'mock-ledger-entry-id' }),
  };

  // 1. Define the mock with an explicit 'any' type to stop the circular inference
  const mockPrismaService: any = {
    roscaCircle: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    roscaMembership: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    roscaContribution: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    systemWallet: {
      findUnique: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
    },
    userTrustStats: {
      upsert: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    roscaCycleSchedule: {
      createMany: jest.fn(),
    },
  };

  // 2. Assign the transaction mock AFTER the object is defined
  mockPrismaService.$transaction = jest.fn((callback) => callback(mockPrismaService));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoscaService,
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<RoscaService>(RoscaService);
    ledgerService = module.get<LedgerService>(LedgerService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  describe('makeContribution (Rule R8)', () => {
    it('should transfer from participant to pool and NOT use WITHDRAWAL movement', async () => {
      // 1. Setup Mocks for an Active Circle/Member
      const contributionAmount = 50000n; // 500 Naira

      mockPrismaService.roscaCircle.findUnique.mockResolvedValue({
        id: mockCircleId,
        status: CircleStatus.ACTIVE,
        contributionAmount,
        latePenaltyPercent: 10,
        schedules: [{ contributionDeadline: new Date(Date.now() + 86400000) }], // Future deadline
      });

      mockPrismaService.roscaMembership.findUnique.mockResolvedValue({
        id: 'membership-uuid',
        status: MembershipStatus.ACTIVE,
      });

      mockPrismaService.systemWallet.findUnique.mockResolvedValue({
        walletId: mockPoolWalletId,
      });

      mockPrismaService.wallet.findUnique.mockResolvedValue({ id: mockWalletId });
      mockPrismaService.roscaContribution.findUnique.mockResolvedValue(null);
      mockPrismaService.roscaContribution.create.mockResolvedValue({ id: 'contrib-uuid' });
      mockPrismaService.userTrustStats.upsert.mockResolvedValue({ trustScore: 50 });

      // 2. Execute
      await service.makeContribution(mockUserId, mockCircleId, 1);

      // 3. Assertions for Rule R8 (Internal Transfer)
      // Check first call: Participant Debit
      expect(mockLedgerService.writeEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: mockWalletId,
          entryType: EntryType.DEBIT,
          movementType: MovementType.TRANSFER, // MUST be Transfer, not Withdrawal
          sourceType: LedgerSourceType.CONTRIBUTION,
          amount: contributionAmount,
        }),
        expect.anything(),
      );

      // Check second call: Pool Credit
      expect(mockLedgerService.writeEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: mockPoolWalletId,
          entryType: EntryType.CREDIT,
          movementType: MovementType.TRANSFER,
          sourceType: LedgerSourceType.CONTRIBUTION,
          amount: contributionAmount,
        }),
        expect.anything(),
      );
    });
  });

  describe('Collateral Invariants (Rule R7)', () => {
    it('should NOT release collateral when a contribution is made', async () => {
      // Setup identical to above
      mockPrismaService.roscaCircle.findUnique.mockResolvedValue({
        id: mockCircleId,
        status: CircleStatus.ACTIVE,
        contributionAmount: 1000n,
        latePenaltyPercent: 0,
        schedules: [{ contributionDeadline: new Date(Date.now() + 86400000) }],
      });
      mockPrismaService.roscaMembership.findUnique.mockResolvedValue({
        id: 'mem-1',
        status: MembershipStatus.ACTIVE,
      });

      await service.makeContribution(mockUserId, mockCircleId, 1);

      // Verify no ledger entry was created for COLLATERAL_RELEASE
      const writeCalls = mockLedgerService.writeEntry.mock.calls;
      const releaseCall = writeCalls.find(
        (call) => call[0].sourceType === LedgerSourceType.COLLATERAL_RELEASE,
      );

      expect(releaseCall).toBeUndefined();
    });
  });
});
