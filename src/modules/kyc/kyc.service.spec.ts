import { Test, TestingModule } from '@nestjs/testing';
import { KycService } from './kyc.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { IdentityVerificationService } from './identity-verification.service';
import { VirtualAccountService } from '../virtual-accounts/virtual-account.service';
import { getQueueToken } from '@nestjs/bullmq';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';

describe('KycService', () => {
  let service: KycService;

  const mockPrisma: any = {
    kYC: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  const mockConfig = { get: jest.fn().mockReturnValue('test-value') };
  const mockIdentityService = { verifyNin: jest.fn(), verifyBvn: jest.fn() };
  const mockVirtualAccountService = { create: jest.fn() };
  const mockQueue = { add: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: IdentityVerificationService, useValue: mockIdentityService },
        { provide: VirtualAccountService, useValue: mockVirtualAccountService },
        { provide: getQueueToken(AUTH_EVENTS_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<KycService>(KycService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
