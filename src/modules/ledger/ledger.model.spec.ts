import { EntryType, MovementType, LedgerSourceType } from '@prisma/client';
import { cleanDb, prisma } from '../../../test/prisma-test-utils';

describe('LedgerEntry model', () => {
  let walletId: string;

  beforeEach(async () => {
    await cleanDb();
    const wallet = await prisma.wallet.create({
      data: { userId: 'user-ledger' },
    });
    walletId = wallet.id;
  });

  afterAll(() => prisma.$disconnect());

  it('allows a valid ledger entry', async () => {
    const entry = await prisma.ledgerEntry.create({
      data: {
        walletId,
        reference: 'tx-1',
        entryType: 'CREDIT',
        movementType: 'FUNDING',
        amount: 100_000n,
        balanceBefore: 0n,
        balanceAfter: 100_000n,
        sourceType: 'TRANSACTION',
        sourceId: 'transaction-id-1',
      },
    });

    expect(entry.balanceAfter).toBe(100_000n);
  });

  it('prevents duplicate idempotent entries', async () => {
    const data = {
      walletId,
      reference: 'tx-dup',
      entryType: EntryType.CREDIT,
      movementType: MovementType.FUNDING,
      amount: 50_000n,
      balanceBefore: 0n,
      balanceAfter: 50_000n,
      sourceType: LedgerSourceType.TRANSACTION,
      sourceId: 'transaction-id-dup',
    };

    await prisma.ledgerEntry.create({ data });

    await expect(prisma.ledgerEntry.create({ data })).rejects.toThrow();
  });
});
