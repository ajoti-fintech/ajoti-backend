import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from '../wallet.service';
import { LedgerService } from '../../ledger/ledger.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('WalletService', () => {
  let service: WalletService;
  let ledgerService: LedgerService;

  const mockWalletId = 'wallet-uuid';

  const mockLedgerService = {
    getDetailedBalance: jest.fn(),
  };

  const mockPrismaService = {
    wallet: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    ledgerService = module.get<LedgerService>(LedgerService);
  });

  describe('getWalletBalance', () => {
    it('should return the correctly formatted balance breakdown', async () => {
      // Mock the internal detailed balance computation
      mockLedgerService.getDetailedBalance.mockResolvedValue({
        total: 100000n, // 1000 Naira
        reserved: 20000n, // 200 Naira
        available: 80000n, // 800 Naira
      });

      const result = await service.getBalance(mockWalletId);

      expect(result).toEqual({
        total: 100000n,
        reserved: 20000n,
        available: 80000n,
      });

      expect(ledgerService.getDetailedBalance).toHaveBeenCalledWith(mockWalletId);
    });

    it('should calculate available balance as total minus reserved', async () => {
      mockLedgerService.getDetailedBalance.mockResolvedValue({
        total: 5000n,
        reserved: 5000n,
        available: 0n,
      });

      const result = await service.getBalance(mockWalletId);
      expect(result.available).toBe(0n);
    });
  });
});
