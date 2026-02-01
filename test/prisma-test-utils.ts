import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export async function cleanDb() {
  await prisma.webhookEvent.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.walletBucket.deleteMany();
  await prisma.wallet.deleteMany();
}
