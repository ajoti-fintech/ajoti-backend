import { TransactionStatus, TransactionType } from '@prisma/client';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { TransactionsService } from '../src/modules/transactions/transactions.service';
import { PrismaService } from '../src/prisma/prisma.service'; // Import the concrete type

/**
 * SIMULATION SCRIPT: Full Funding Flow
 * Run this to see how the system handles a v4 webhook from start to finish.
 */
async function simulate() {
  const prisma = new PrismaService();
  const ledgerService = new LedgerService(prisma);
  const transService = new TransactionsService(prisma);

  // Mocking the dependencies for the Webhook Service
  // In a real test, you'd use a TestingModule, but this script is for quick local validation.
  const mockFlwService = {
    verifyTransaction: async (id: string) => ({
      status: 'success',
      data: {
        id: parseInt(id),
        tx_ref: 'SIM-TX-001',
        status: 'successful',
        amount: 2500.0, // 2500 NGN
        currency: 'NGN',
      },
    }),
  } as any;

  // Note: Adjusting the constructor call based on the provided correct code snippet
  const webhookService = new WebhooksService(prisma, ledgerService, transService, mockFlwService);

  console.log('🚀 Starting Full Flow Simulation...');

  try {
    // 1. Create a Test Wallet
    const user = await prisma.wallet.upsert({
      where: { userId: 'sim-user-1' },
      update: {},
      create: { userId: 'sim-user-1', currency: 'NGN' },
    });

    // 2. Create or Reset a Pending Transaction
    const txRef = 'SIM-TX-001';
    const tx = await prisma.transaction.upsert({
      where: { reference: txRef },
      update: {
        status: TransactionStatus.PENDING,
        amount: 250000n,
      },
      create: {
        walletId: user.id,
        amount: 250000n, // 2500 NGN in kobo
        currency: 'NGN',
        reference: txRef,
        status: TransactionStatus.PENDING,
        provider: 'FLUTTERWAVE',
        type: TransactionType.FUNDING,
      },
    });
    console.log(`📡 Step 1: Initialised Pending Transaction: ${tx.reference}`);

    // 3. Simulate receiving the Webhook
    // FIXED: Added 'amount' and 'currency' to the mock payload to prevent NaN -> BigInt errors
    const mockPayload = {
      event: 'charge.completed',
      data: {
        id: 999111,
        tx_ref: txRef,
        status: 'successful',
        amount: 2500,
        currency: 'NGN',
      },
    };

    console.log('🔗 Step 2: Receiving Webhook Payload...');
    await webhookService.processFundingWebhook(mockPayload);

    // 4. Verification
    const finalBalance = await ledgerService.getDetailedBalance(user.id);
    const finalTx = await transService.findByProviderRef(txRef);

    console.log('\n--- SIMULATION RESULTS ---');
    console.log(
      `Status: ${finalTx?.status === TransactionStatus.SUCCESS ? '✅ SUCCESS' : '❌ FAILED'}`,
    );
    console.log(`Total Balance: ${Number(finalBalance.total) / 100} NGN`);
    console.log(`Ledger Entry Created: ${finalBalance.total > 0n}`);
  } catch (error) {
    console.error('❌ Simulation Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

simulate();
