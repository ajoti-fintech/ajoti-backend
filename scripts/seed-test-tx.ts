import { PrismaClient, TransactionStatus, WalletStatus, TransactionType } from '@prisma/client';

/**
 * DATABASE SEEDING SCRIPT (v1.2.3)
 * Purpose: Prepares the database for manual webhook testing.
 * Creates: 1 User, 1 Active Wallet, 1 Pending Transaction.
 */

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Starting manual seed for Ajoti Wallet...');

  // 1. Clean up existing test data (Optional, but makes tests repeatable)
  // Note: In a production-like dev environment, be careful with deletes.
  const testUserId = 'test-user-001';

  // 2. Create or Update the Wallet
  // Since we don't have an Auth module yet, we use a static test-user-id.
  const wallet = await prisma.wallet.upsert({
    where: { userId: testUserId },
    update: { status: WalletStatus.ACTIVE },
    create: {
      userId: testUserId,
      currency: 'NGN',
      status: WalletStatus.ACTIVE,
    },
  });

  console.log(`✅ Wallet ${wallet.status}: ${wallet.id} (User: ${testUserId})`);

  // 3. Create a PENDING Transaction
  // We use 'TEST-REF-001' which we will later send in our mock Flutterwave payload.
  const txRef = 'TEST-REF-001';

  const transaction = await prisma.transaction.upsert({
    where: { reference: txRef },
    update: { status: TransactionStatus.PENDING },
    create: {
      walletId: wallet.id,
      amount: 500000n, // 5,000.00 NGN in kobo
      currency: 'NGN',
      provider: 'FLUTTERWAVE',
      reference: txRef,
      status: TransactionStatus.PENDING,
      type: TransactionType.FUNDING,
    },
  });

  console.log(`✅ Pending Transaction Created: ${transaction.reference}`);

  console.log('\n--- NEXT STEPS ---');
  console.log('1. Verify in Prisma Studio: npx prisma studio');
  console.log('2. Test the Webhook using this cURL:');
  console.log(`
  curl -X POST http://localhost:3000/api/webhooks/flutterwave \\
  -H "Content-Type: application/json" \\
  -H "verif-hash: test_hash" \\
  -d '{
    "event": "charge.completed",
    "data": {
      "id": 87654321,
      "tx_ref": "${txRef}",
      "status": "successful",
      "amount": 5000,
      "currency": "NGN",
      "customer": { "email": "test@ajoti.com" }
    }
  }'
  `);
}

seed()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
