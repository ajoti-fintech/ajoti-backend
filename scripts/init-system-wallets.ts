import { PrismaClient, SystemWalletType, Prisma, Gender, Role, BucketType } from '@prisma/client';

export async function initializeSystemWallets(prisma: PrismaClient) {
  return await prisma.$transaction(
    async (tx) => {
      // 1. Idempotency Check
      const existing = await tx.systemWallet.findFirst();
      if (existing) {
        console.log('✅ System wallets already initialized');
        return;
      }

      const systemUsers = [
        {
          id: 'SYSTEM_PLATFORM_POOL',
          email: 'pool@ajoti.system',
          phone: '+2340000000001',
          firstName: 'Platform',
          lastName: 'Pool',
        },
        {
          id: 'SYSTEM_RECIPIENT_BASE',
          email: 'recipient@ajoti.system',
          phone: '+2340000000002',
          firstName: 'Recipient',
          lastName: 'Base',
        },
      ];

      for (const u of systemUsers) {
        // 2. Upsert System Users
        const user = await tx.user.upsert({
          where: { id: u.id },
          update: {},
          create: {
            id: u.id,
            email: u.email,
            phone: u.phone,
            firstName: u.firstName,
            lastName: u.lastName,
            password: 'SYSTEM_LOCKED_ACCOUNT',
            gender: Gender.MALE,
            role: Role.ADMIN,
            isVerified: true,
            dob: new Date('1970-01-01'), // Explicit "System" DOB
          },
        });

        // 3. Create Wallet if it doesn't exist
        const wallet = await tx.wallet.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            currency: 'NGN',
            status: 'ACTIVE',
          },
        });

        // 4. Initialize the MAIN Bucket (Essential for your Ledger logic)
        await tx.walletBucket.upsert({
          where: {
            walletId_bucketType_sourceId: {
              walletId: wallet.id,
              bucketType: BucketType.MAIN,
              sourceId: user.id,
            },
          },
          update: {},
          create: {
            walletId: wallet.id,
            bucketType: BucketType.MAIN,
            sourceId: user.id, // System wallets point to their own User ID as source
            reservedAmount: 0n,
          },
        });

        // 5. Map to SystemWallet
        const systemType =
          u.id === 'SYSTEM_PLATFORM_POOL'
            ? SystemWalletType.PLATFORM_POOL
            : SystemWalletType.RECIPIENT_BASE;

        await tx.systemWallet.upsert({
          where: { type: systemType },
          update: { walletId: wallet.id },
          create: {
            type: systemType,
            walletId: wallet.id,
          },
        });
      }

      console.log('✅ System initialization complete with Buckets');
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
