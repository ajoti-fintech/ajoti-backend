import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { FlutterwaveProvider } from '../src/modules/flutterwave/flutterwave.provider';

/**
 * Standalone sandbox connectivity test.
 * Run with: npx ts-node -r tsconfig-paths/register scripts/test-sandbox.ts
 *
 * Reads from your .env automatically via dotenv/config above.
 * Set MOCK_FLUTTERWAVE=false to ensure real API calls are made.
 */
async function testSandbox() {
  console.log('📡 Testing Flutterwave v3 Sandbox Connectivity...\n');

  // Wire up a ConfigService that mirrors what the NestJS DI container would provide.
  // flutterwaveConfig() reads FLW_SECRET_KEY_TEST / FLW_SECRET_KEY_LIVE etc. from env.
  const config = new ConfigService({
    flutterwave: {
      isLive: false,
      env: 'test',
      secretKey: process.env.FLW_SECRET_KEY_TEST ?? '',
      publicKey: process.env.FLW_PUBLIC_KEY_TEST ?? '',
      webhookHash: process.env.FLW_WEBHOOK_HASH_TEST ?? '',
      baseUrl: process.env.FLW_BASE_URL ?? 'https://api.flutterwave.com/v3',
      bypassWebhookVerification: false,
      mockMode: false, // Force real API calls in this test
      testBvn: '22222222222',
    },
  });

  const flw = new FlutterwaveProvider(config);

  // ── 1. Verify secret key is present ────────────────────────────────────────
  const secretKey = process.env.FLW_SECRET_KEY_TEST;
  if (!secretKey) {
    console.error('❌ FLW_SECRET_KEY_TEST is not set in your .env file.');
    console.error('   Add: FLW_SECRET_KEY_TEST=FLWSECK_TEST-...');
    process.exit(1);
  }
  console.log('✅ FLW_SECRET_KEY_TEST found\n');

  // ── 2. Test: Fetch Nigerian bank list ───────────────────────────────────────
  console.log('── Test 1: Fetch Nigerian bank list ──────────────────');
  try {
    const banksResponse = await flw.getBanks('NG');
    if (banksResponse.status === 'success') {
      console.log(`✅ Connected! Found ${banksResponse.data.length} banks.`);
      console.log(
        '   Sample banks:',
        banksResponse.data
          .slice(0, 3)
          .map((b) => `${b.name} (${b.code})`)
          .join(', '),
        '\n',
      );
    } else {
      console.error('❌ Bank list call returned non-success:', banksResponse.message);
    }
  } catch (e: any) {
    console.error('❌ Bank list failed:', e.response?.data ?? e.message);
  }

  // ── 3. Test: Initiate a payment session ────────────────────────────────────
  console.log('── Test 2: Initiate hosted checkout payment ──────────');
  try {
    const paymentResponse = await flw.initiatePayment({
      tx_ref: `TEST-${Date.now()}`,
      amount: 100, // 100 NGN
      currency: 'NGN',
      redirect_url: 'http://localhost:3000/api/wallet/funding/callback',
      customer: {
        email: 'sandbox@ajoti.com',
        name: 'Sandbox Tester',
      },
      payment_options: 'card,banktransfer,ussd',
      customizations: {
        title: 'Ajoti Sandbox Test',
        description: 'Testing payment initialization',
      },
    });

    if (paymentResponse.status === 'success') {
      console.log('✅ Payment session created!');
      console.log('   Checkout URL:', paymentResponse.data.link, '\n');
    } else {
      console.error('❌ Payment init failed:', paymentResponse.message);
    }
  } catch (e: any) {
    console.error('❌ Payment init error:', e.response?.data ?? e.message);
  }

  // ── 4. Test: Resolve a test bank account ───────────────────────────────────
  console.log('── Test 3: Resolve test bank account ─────────────────');
  try {
    // FLW test account: 0690000031 at Access Bank (044)
    const resolveResponse = await flw.resolveAccountName('0690000031', '044');
    if (resolveResponse.status === 'success' && resolveResponse.data) {
      console.log('✅ Account resolved!');
      console.log('   Account name:', resolveResponse.data.account_name, '\n');
    } else {
      console.warn('⚠️  Account resolve returned:', resolveResponse.message, '\n');
    }
  } catch (e: any) {
    console.error('❌ Account resolve error:', e.response?.data ?? e.message);
  }

  // ── 5. Test: Webhook signature verification ────────────────────────────────
  console.log('── Test 4: Webhook signature verification ────────────');
  const webhookHash = process.env.FLW_WEBHOOK_HASH_TEST ?? '';
  if (webhookHash) {
    const validResult = flw.verifyWebhookSignature(webhookHash);
    const invalidResult = flw.verifyWebhookSignature('wrong-hash');
    console.log('✅ Valid hash accepted:', validResult);
    console.log('✅ Invalid hash rejected:', !invalidResult, '\n');
  } else {
    console.warn('⚠️  FLW_WEBHOOK_HASH_TEST not set — skipping signature test\n');
  }

  console.log('── Sandbox test complete ─────────────────────────────');
}

testSandbox().catch(console.error);