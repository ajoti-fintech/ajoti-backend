import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from '../ledger.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { EntryType, MovementType, BucketType, LedgerSourceType, Prisma } from '@prisma/client';

describe('LedgerService', () => {
  let service: LedgerService;
  let prisma: PrismaService;

  // Mock data for consistency
  const mockWalletId = 'wallet-123';
  const mockSourceId = 'tx-456';

  // Comprehensive Mock Prisma Object
  const mockPrisma = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
    $executeRaw: jest.fn(),
    ledgerEntry: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    walletBucket: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      aggregate: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LedgerService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<LedgerService>(LedgerService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  describe('writeEntry (Arithmetic & Causality)', () => {
    it('should correctly calculate balanceAfter on a CREDIT', async () => {
      // Setup: Initial balance is 1000 kobo (10 Naira)
      mockPrisma.ledgerEntry.findFirst.mockResolvedValue({ balanceAfter: 1000n });
      mockPrisma.walletBucket.findMany.mockResolvedValue([]);

      const params = {
        walletId: mockWalletId,
        entryType: EntryType.CREDIT,
        movementType: MovementType.FUNDING,
        amount: 500n, // Add 5 Naira
        reference: 'ref-1',
        sourceType: LedgerSourceType.TRANSACTION,
        sourceId: mockSourceId,
      };

      await service.writeEntry(params);

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          balanceBefore: 1000n,
          balanceAfter: 1500n, // Total increases
        }),
      });
    });

    it('should correctly calculate balanceAfter on a DEBIT', async () => {
      // Setup: Initial balance 2000, No reservations
      mockPrisma.ledgerEntry.findFirst.mockResolvedValue({ balanceAfter: 2000n });
      mockPrisma.walletBucket.findMany.mockResolvedValue([]);

      const params = {
        walletId: mockWalletId,
        entryType: EntryType.DEBIT,
        movementType: MovementType.WITHDRAWAL,
        amount: 500n,
        reference: 'ref-1',
        sourceType: LedgerSourceType.TRANSACTION,
        sourceId: mockSourceId,
      };

      await service.writeEntry(params);

      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          balanceBefore: 2000n,
          balanceAfter: 1500n, // Total decreases
        }),
      });
    });

    it('should NOT change total balanceAfter on a RESERVE entry', async () => {
      // Setup: Initial balance 5000
      mockPrisma.ledgerEntry.findFirst.mockResolvedValue({ balanceAfter: 5000n });
      mockPrisma.walletBucket.findMany.mockResolvedValue([]);

      const params = {
        walletId: mockWalletId,
        entryType: EntryType.RESERVE,
        movementType: MovementType.TRANSFER,
        bucketType: BucketType.ROSCA,
        amount: 1000n,
        reference: 'reserve-ref',
        sourceType: LedgerSourceType.ROSCA_CIRCLE,
        sourceId: 'circle-uuid',
      };

      await service.writeEntry(params);

      // Total balance remains unchanged during a reservation
      expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          balanceBefore: 5000n,
          balanceAfter: 5000n,
        }),
      });

      // But the bucket must be updated to track the lock
      expect(mockPrisma.walletBucket.upsert).toHaveBeenCalled();
    });

    it('should throw BadRequestException for negative or zero amounts', async () => {
      const params = {
        walletId: mockWalletId,
        entryType: EntryType.CREDIT,
        movementType: MovementType.FUNDING,
        amount: 0n,
        reference: 'ref-1',
        sourceType: LedgerSourceType.TRANSACTION,
        sourceId: mockSourceId,
      };

      await expect(service.writeEntry(params as any)).rejects.toThrow(BadRequestException);
    });

    it('should enforce sourceId and sourceType presence', async () => {
      // This tests that our service respects the v1.2.3 mandatory causality
      const params = {
        walletId: mockWalletId,
        entryType: EntryType.CREDIT,
        movementType: MovementType.FUNDING,
        amount: 100n,
        reference: 'ref-1',
        // sourceType and sourceId missing
      };

      // Type cast to allow compilation of the "bad" test
      await expect(service.writeEntry(params as any)).rejects.toThrow();
    });
  });
});
