// scripts/seed-sim-db.ts
/**
 * Seeds the simulation database (SIM_NEON_DB_URL) with the system wallets
 * required by PayoutService (PLATFORM_POOL) and other ledger operations.
 *
 * Run once after `prisma:sim:migrate`, or any time the sim DB is reset:
 *   pnpm prisma:sim:seed
 *
 * Note: We run each upsert individually rather than inside a Serializable
 * callback transaction because Neon's serverless pooler does not support
 * interactive transactions (Prisma P2028). The upserts are already idempotent
 * so no transaction wrapper is needed for this one-time setup.
 */
import { PrismaClient, SystemWalletType, Gender, Role, BucketType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

function makePrisma() {
  const connectionString = process.env.SIM_NEON_DB_URL;
  if (!connectionString) throw new Error('SIM_NEON_DB_URL is missing from .env');
  const pool = new Pool({ connectionString });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

const prisma = makePrisma();

const SYSTEM_USERS = [
  {
    id: 'SYSTEM_PLATFORM_POOL',
    email: 'pool@ajoti.system',
    phone: '+2340000000001',
    firstName: 'Platform',
    lastName: 'Pool',
    walletType: SystemWalletType.PLATFORM_POOL,
  },
  {
    id: 'SYSTEM_RECIPIENT_BASE',
    email: 'recipient@ajoti.system',
    phone: '+2340000000002',
    firstName: 'Recipient',
    lastName: 'Base',
    walletType: SystemWalletType.RECIPIENT_BASE,
  },
];

async function main() {
  console.log('🏗️  Seeding simulation database...');

  const existing = await prisma.systemWallet.findFirst();
  if (existing) {
    console.log('✅  System wallets already initialized.');
    return;
  }

  for (const u of SYSTEM_USERS) {
    const user = await prisma.user.upsert({
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
        dob: new Date('1970-01-01'),
      },
    });

    const wallet = await prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, currency: 'NGN', status: 'ACTIVE' },
    });

    await prisma.walletBucket.upsert({
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
        sourceId: user.id,
        reservedAmount: 0n,
      },
    });

    await prisma.systemWallet.upsert({
      where: { type: u.walletType },
      update: { walletId: wallet.id },
      create: { type: u.walletType, walletId: wallet.id },
    });

    console.log(`  ✓ ${u.firstName} ${u.lastName} (${u.walletType})`);
  }

  console.log('✅  Simulation database ready.');
}

main()
  .catch((e) => {
    console.error('❌  Sim seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
