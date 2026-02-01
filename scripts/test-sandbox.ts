import 'dotenv/config'; // Loads .env if present (optional for local testing)
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { FlutterwaveService } from '../src/modules/transactions/flutterwave.service'; // Adjust path if needed

// Mocking Nest context for a simple standalone script
async function testSandbox() {
  console.log('📡 Testing Flutterwave v4 Sandbox Connectivity...');

  // Mock ConfigService with your v4 sandbox credentials
  // Replace these with your actual values (better to use real .env in practice)
  const config = new ConfigService({
    FLW_CLIENT_ID: process.env.FLW_CLIENT_ID,
    FLW_CLIENT_SECRET: process.env.FLW_CLIENT_SECRET,
    // Optional: FLUTTERWAVE_BASE_URL: 'https://developersandbox-api.flutterwave.com' (but service hardcodes sandbox)
  });

  const httpService = new HttpService();
  const flwService = new FlutterwaveService(httpService, config);

  try {
    // Use the updated v4 method (returns balance for specific currency)
    const balanceResponse = await flwService.getBalance('NGN');

    console.log('✅ Connected to Flutterwave v4 Sandbox!');
    console.log('💰 NGN Balance Details:', JSON.stringify(balanceResponse, null, 2));
  } catch (e: any) {
    console.error('❌ Connectivity Failed:');
    console.error('Message:', e.message);
    if (e.response) {
      console.error('Status:', e.response.status);
      console.error('Response Data:', JSON.stringify(e.response.data, null, 2));
    } else {
      console.error('Error:', e);
    }
  }
}

testSandbox();
