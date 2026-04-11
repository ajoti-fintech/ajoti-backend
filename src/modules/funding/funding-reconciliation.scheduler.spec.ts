import { TransactionStatus, TransactionType } from '@prisma/client';
import { DelayedError } from 'bullmq';
import { FundingReconciliationScheduler } from './funding-reconciliation.scheduler';
import { FundingReconciliationJobName } from './funding.queue';

describe('FundingReconciliationScheduler', () => {
  const prisma = {
    transaction: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ledgerEntry: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const flw = {
    verifyTransactionByReference: jest.fn(),
  };

  const fundingQueue = {
    getJob: jest.fn(),
    add: jest.fn(),
  };

  let service: FundingReconciliationScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.transaction.updateMany.mockResolvedValue({ count: 1 });
    service = new FundingReconciliationScheduler(
      prisma as any,
      flw as any,
      fundingQueue as any,
    );
  });

  it('queues startup catch-up jobs without duplicating existing jobs', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        reference: 'AJT-FUND-1',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
      {
        reference: 'AJT-FUND-2',
        createdAt: new Date(),
      },
    ]);
    fundingQueue.getJob
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'AJT-FUND-2' });

    await service.onModuleInit();

    expect(fundingQueue.add).toHaveBeenCalledTimes(1);
    expect(fundingQueue.add).toHaveBeenCalledWith(
      FundingReconciliationJobName.VERIFY_PENDING,
      { reference: 'AJT-FUND-1' },
      expect.objectContaining({
        jobId: 'AJT-FUND-1',
        delay: 0,
      }),
    );
  });

  it('requeues a still-pending funding job with the same reference', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      walletId: 'wallet-1',
      reference: 'AJT-FUND-1',
      amount: 500000n,
      status: TransactionStatus.PENDING,
      type: TransactionType.FUNDING,
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      metadata: null,
    });
    flw.verifyTransactionByReference.mockResolvedValue({
      status: 'success',
      message: 'still pending',
      data: {
        id: 1,
        tx_ref: 'AJT-FUND-1',
        flw_ref: 'FLW-1',
        amount: 5000,
        charged_amount: 5000,
        currency: 'NGN',
        status: 'pending',
        payment_type: 'card',
        customer: {
          id: 1,
          name: 'Ayo Tester',
          email: 'user@example.com',
        },
      },
    });

    const job = {
      id: 'AJT-FUND-1',
      data: { reference: 'AJT-FUND-1' },
      moveToDelayed: jest.fn(),
    };

    await expect(
      service.processQueuedVerification(job as any, 'token-1'),
    ).rejects.toBeInstanceOf(DelayedError);

    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'tx-1',
        status: TransactionStatus.PENDING,
      },
      data: {
        metadata: expect.objectContaining({
          backgroundJobLastOutcome: 'still_pending',
          backgroundJobRetryCount: 1,
          backgroundJobLastProviderStatus: 'pending',
          backgroundJobLastProviderMessage: 'still pending',
        }),
      },
    });
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'token-1');
  });

  it('marks provider-failed funding rows as failed with completedAt', async () => {
    prisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      walletId: 'wallet-1',
      reference: 'AJT-FUND-1',
      amount: 500000n,
      status: TransactionStatus.PENDING,
      type: TransactionType.FUNDING,
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
      metadata: {},
    });
    flw.verifyTransactionByReference.mockResolvedValue({
      status: 'success',
      message: 'failed',
      data: {
        id: 1,
        tx_ref: 'AJT-FUND-1',
        flw_ref: 'FLW-1',
        amount: 5000,
        charged_amount: 5000,
        currency: 'NGN',
        status: 'failed',
        payment_type: 'card',
        customer: {
          id: 1,
          name: 'Ayo Tester',
          email: 'user@example.com',
        },
      },
    });

    const result = await service.reconcileByReference('AJT-FUND-1', 'admin-1', 'MANUAL');

    expect(result.outcome).toBe('marked_failed');
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({
        status: TransactionStatus.FAILED,
        completedAt: expect.any(Date),
        metadata: expect.objectContaining({
          reconciliationFailureReason: 'Provider marked transaction as failed',
          manualReconciledBy: 'admin-1',
        }),
      }),
    });
  });
});
