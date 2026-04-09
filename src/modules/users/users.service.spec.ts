import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VirtualAccountService } from '../virtual-accounts/virtual-account.service';
import { WalletService } from '../wallet/wallet.service';
import { NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrisma: any = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockVirtualAccountService = { getOrCreate: jest.fn() };
  const mockWalletService = { getBalance: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: VirtualAccountService, useValue: mockVirtualAccountService },
        { provide: WalletService, useValue: mockWalletService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findById', () => {
    it('should return a user when found', async () => {
      const mockUser = { id: 'user-1', email: 'test@test.com', firstName: 'Test', lastName: 'User', wallet: null };
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.findById('user-1');
      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
