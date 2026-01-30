import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from '../../wallet/wallet.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { LedgerService } from '../../ledger/ledger.service';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { WalletStatus } from '@prisma/client';

describe('WalletService', () => {
  let service: WalletService;
  let prismaService: PrismaService;
  let ledgerService: LedgerService;

  const mockWallet = {
    id: 'wallet-123',
    userId: 'user-123',
    currency: 'NGN',
    status: WalletStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBuckets = [
    {
      id: 'bucket-1',
      walletId: 'wallet-123',
      bucketType: 'ROSCA',
      reservedAmount: 50000n,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'bucket-2',
      walletId: 'wallet-123',
      bucketType: 'TARGET',
      reservedAmount: 30000n,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockPrismaService = {
    wallet: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    walletBucket: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    ledgerEntry: {
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockLedgerService = {
    computeBalance: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: LedgerService,
          useValue: mockLedgerService,
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    prismaService = module.get<PrismaService>(PrismaService);
    ledgerService = module.get<LedgerService>(LedgerService);

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createWallet', () => {
    it('should create a new wallet with buckets', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          wallet: { create: jest.fn().mockResolvedValue(mockWallet) },
          walletBucket: { createMany: jest.fn().mockResolvedValue({ count: 4 }) },
        };
        return callback(tx);
      });

      const result = await service.createWallet('user-123');

      expect(result).toEqual(mockWallet);
      expect(mockPrismaService.wallet.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('should throw ConflictException if wallet already exists', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      await expect(service.createWallet('user-123')).rejects.toThrow(ConflictException);
    });
  });

  describe('getOrCreateWallet', () => {
    it('should return existing wallet', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await service.getOrCreateWallet('user-123');

      expect(result).toEqual(mockWallet);
      expect(mockPrismaService.wallet.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('should create wallet if it does not exist', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          wallet: { create: jest.fn().mockResolvedValue(mockWallet) },
          walletBucket: { createMany: jest.fn().mockResolvedValue({ count: 4 }) },
        };
        return callback(tx);
      });

      const result = await service.getOrCreateWallet('user-123');

      expect(result).toEqual(mockWallet);
    });

    it('should throw BadRequestException for invalid userId', async () => {
      await expect(service.getOrCreateWallet('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getWalletById', () => {
    it('should return wallet by id', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await service.getWalletById('wallet-123');

      expect(result).toEqual(mockWallet);
    });

    it('should throw NotFoundException if wallet does not exist', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getWalletById('wallet-123')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBalance', () => {
    it('should compute balance correctly', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockLedgerService.computeBalance.mockResolvedValue(200000n);
      mockPrismaService.walletBucket.findMany.mockResolvedValue(mockBuckets);

      const result = await service.getBalance('wallet-123');

      expect(result).toEqual({
        total: 200000n,
        reserved: 80000n, // 50000 + 30000
        available: 120000n, // 200000 - 80000
      });
    });

    it('should throw BadRequestException if available balance is negative', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockLedgerService.computeBalance.mockResolvedValue(50000n);
      mockPrismaService.walletBucket.findMany.mockResolvedValue(mockBuckets);

      // Reserved (80000) > Total (50000) = negative available
      await expect(service.getBalance('wallet-123')).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateWalletStatus', () => {
    it('should update wallet status', async () => {
      const updatedWallet = { ...mockWallet, status: WalletStatus.SUSPENDED };
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockPrismaService.wallet.update.mockResolvedValue(updatedWallet);

      const result = await service.updateWalletStatus('wallet-123', WalletStatus.SUSPENDED);

      expect(result.status).toBe(WalletStatus.SUSPENDED);
    });
  });

  describe('isWalletActive', () => {
    it('should return true for active wallet', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await service.isWalletActive('wallet-123');

      expect(result).toBe(true);
    });

    it('should return false for suspended wallet', async () => {
      const suspendedWallet = {
        ...mockWallet,
        status: WalletStatus.SUSPENDED,
      };
      mockPrismaService.wallet.findUnique.mockResolvedValue(suspendedWallet);

      const result = await service.isWalletActive('wallet-123');

      expect(result).toBe(false);
    });
  });

  describe('hasSufficientBalance', () => {
    it('should return true if balance is sufficient', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockLedgerService.computeBalance.mockResolvedValue(200000n);
      mockPrismaService.walletBucket.findMany.mockResolvedValue(mockBuckets);

      const result = await service.hasSufficientBalance('wallet-123', 100000n);

      expect(result).toBe(true);
    });

    it('should return false if balance is insufficient', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockLedgerService.computeBalance.mockResolvedValue(200000n);
      mockPrismaService.walletBucket.findMany.mockResolvedValue(mockBuckets);

      const result = await service.hasSufficientBalance('wallet-123', 150000n);

      expect(result).toBe(false);
    });
  });

  describe('verifyWalletOwnership', () => {
    it('should not throw for correct owner', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      await expect(service.verifyWalletOwnership('wallet-123', 'user-123')).resolves.not.toThrow();
    });

    it('should throw NotFoundException for incorrect owner', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);

      await expect(service.verifyWalletOwnership('wallet-123', 'wrong-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getWalletStats', () => {
    it('should return wallet statistics', async () => {
      mockPrismaService.wallet.findUnique.mockResolvedValue(mockWallet);
      mockPrismaService.ledgerEntry.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(60) // credits
        .mockResolvedValueOnce(40); // debits
      mockPrismaService.ledgerEntry.findFirst.mockResolvedValue({
        createdAt: new Date('2024-01-29'),
      });

      const result = await service.getWalletStats('wallet-123');

      expect(result).toEqual({
        totalTransactions: 100,
        totalCredits: 60,
        totalDebits: 40,
        lastTransaction: new Date('2024-01-29'),
      });
    });
  });
});
