import { PrismaClient, Role } from '@prisma/client';
import { hashValue } from '../src/common/security/hash';
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { initializeSystemWallets } from '../scripts/init-system-wallets';

function makePrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is missing');

  const pool = new Pool({ connectionString });
  return new PrismaClient({
    adapter: new PrismaPg(pool),
  });
}

const prisma = makePrisma();

async function main() {
  // 1. Initialize System Wallets First (Infrastructure)
  console.log('🏗️ Initializing System Wallets...');
  await initializeSystemWallets(prisma);

  // 2. Setup SuperAdmin
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.error('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are required');
    return;
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    console.log('✅ SUPERADMIN already exists');
    return;
  }

  const passwordHash = await hashValue(password);

  console.log('👤 Creating SUPERADMIN...');
  const user = await prisma.user.create({
    data: {
      firstName: 'Super',
      lastName: 'Admin',
      email,
      password: passwordHash,
      dob: new Date('1990-01-01T00:00:00.000Z'),
      gender: 'MALE',
      phone: '+10000000000',
      role: Role.SUPERADMIN,
      isVerified: true,
      profile: { create: {} },
      kyc: { create: {} },
      // 🟢 Add a wallet for the admin so they can test ROSCA features
      wallet: {
        create: {
          currency: 'NGN',
          status: 'ACTIVE',
        },
      },
    },
  });

  console.log('🚀 Seed complete:', {
    email: user.email,
  });
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
