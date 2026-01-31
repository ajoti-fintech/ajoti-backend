import { PrismaClient, Role } from '@prisma/client';
import { hashValue } from '../src/common/security/hash';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

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
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.error('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD environment variables are required');
    return;
  }

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    console.log('SUPERADMIN already exists');
    return;
  }

  const passwordHash = await hashValue(password);

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
    },
  });

  console.log('SUPERADMIN created:', {
    email: user.email,
    password,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
