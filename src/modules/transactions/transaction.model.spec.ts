import { prisma, cleanDb } from '@/../test/prisma-test-utils';

describe('Transaction model', () => {
  let walletId: string;

  beforeEach(async () => {
    await cleanDb();
    walletId = (await prisma.wallet.create({ data: { userId: 'user-tx' } })).id;
  });

  afterAll(() => prisma.$disconnect());

  it('stores a pending Flutterwave transaction', async () => {
    const tx = await prisma.transaction.create({
      data: {
        walletId,
        reference: 'fw-ref-123',
        amount: 100_000n,
        status: 'PENDING',
        type: 'FUNDING',
      },
    });

    expect(tx.status).toBe('PENDING');
  });

  it('does NOT touch ledger automatically', async () => {
    const ledgerCount = await prisma.ledgerEntry.count();
    expect(ledgerCount).toBe(0);
  });
});
