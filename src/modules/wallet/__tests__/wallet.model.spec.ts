import { prisma, cleanDb } from '@/../test/prisma-test-utils';

describe('Wallet model', () => {
  beforeEach(cleanDb);
  afterAll(() => prisma.$disconnect());

  it('creates one wallet per user', async () => {
    await prisma.wallet.create({
      data: { userId: 'user-1' },
    });

    await expect(
      prisma.wallet.create({
        data: { userId: 'user-1' },
      }),
    ).rejects.toThrow();
  });

  it('defaults to NGN and ACTIVE', async () => {
    const wallet = await prisma.wallet.create({
      data: { userId: 'user-2' },
    });

    expect(wallet.currency).toBe('NGN');
    expect(wallet.status).toBe('ACTIVE');
  });
});
