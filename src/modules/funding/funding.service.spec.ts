import { FundingService } from './funding.service';

describe('FundingService', () => {
  const walletService = {
    getOrCreateWallet: jest.fn(),
  };

  const transactionsService = {
    create: jest.fn(),
    markAsFailed: jest.fn(),
  };

  const flw = {
    initiatePayment: jest.fn(),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    transaction: {
      findUnique: jest.fn(),
    },
  };

  const fundingReconciliationScheduler = {
    scheduleInitialVerification: jest.fn(),
    reconcileByReference: jest.fn(),
  };

  let service: FundingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FundingService(
      walletService as any,
      transactionsService as any,
      flw as any,
      prisma as any,
      fundingReconciliationScheduler as any,
    );
  });

  it('creates baseline metadata and queues delayed verification on initialize', async () => {
    walletService.getOrCreateWallet.mockResolvedValue({
      id: 'wallet-1',
      status: 'ACTIVE',
    });
    transactionsService.create.mockResolvedValue({ id: 'tx-1' });
    prisma.user.findUnique.mockResolvedValue({
      email: 'user@example.com',
      firstName: 'Ayo',
      lastName: 'Tester',
      phone: '+2348000000000',
    });
    flw.initiatePayment.mockResolvedValue({
      status: 'success',
      message: 'ok',
      data: {
        link: 'https://checkout.flutterwave.com/pay/test',
      },
    });

    const result = await service.initialize('user-1', {
      amount: 500000,
      redirectUrl: 'https://app.ajoti.com/funding/callback',
      metadata: { channel: 'mobile' },
    });

    expect(transactionsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'wallet-1',
        metadata: expect.objectContaining({
          channel: 'mobile',
          source: 'HOSTED_CHECKOUT',
          redirectUrl: 'https://app.ajoti.com/funding/callback',
          initializedAt: expect.any(String),
        }),
      }),
    );
    expect(fundingReconciliationScheduler.scheduleInitialVerification).toHaveBeenCalledWith(
      result.reference,
    );
    expect(result).toEqual({
      reference: expect.stringMatching(/^AJT-FUND-/),
      authorizationUrl: 'https://checkout.flutterwave.com/pay/test',
      provider: 'FLUTTERWAVE',
    });
  });

  it('verifies pending funding using the user verify source', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      reference: 'AJT-FUND-1',
      status: 'PENDING',
      wallet: { userId: 'user-1' },
    });
    fundingReconciliationScheduler.reconcileByReference.mockResolvedValue({
      outcome: 'still_pending',
    });

    await service.verifyFunding('user-1', 'AJT-FUND-1');

    expect(fundingReconciliationScheduler.reconcileByReference).toHaveBeenCalledWith(
      'AJT-FUND-1',
      'user-1',
      'USER_VERIFY',
    );
  });
});
