import { registerAs } from '@nestjs/config';

/**
 * Flutterwave environment-aware config factory.
 *
 * Switch logic (in order of precedence):
 *  1. FLW_ENV=live  → always uses live keys
 *  2. FLW_ENV=test  → always uses test keys
 *  3. NODE_ENV=production (and FLW_ENV unset) → live keys
 *  4. Anything else → test keys
 *
 * To flip modes locally: set FLW_ENV=live in your .env file.
 * Never set FLW_ENV in CI/production — rely on NODE_ENV there.
 */
export const flutterwaveConfig = registerAs('flutterwave', () => {
    const explicitEnv = process.env.FLW_ENV?.toLowerCase();
    const isLive =
        explicitEnv === 'live' ||
        (explicitEnv !== 'test' && process.env.NODE_ENV === 'production');
    const bypassRequested = process.env.BYPASS_WEBHOOK_VERIFICATION === 'true';

    const secretKey = isLive
        ? process.env.FLW_SECRET_KEY_LIVE
        : process.env.FLW_SECRET_KEY_TEST;

    const publicKey = isLive
        ? process.env.FLW_PUBLIC_KEY_LIVE
        : process.env.FLW_PUBLIC_KEY_TEST;

    const webhookHash = isLive
        ? process.env.FLW_WEBHOOK_HASH_LIVE
        : process.env.FLW_WEBHOOK_HASH_TEST;

    // Hard-fail in production if credentials are missing
    if (process.env.NODE_ENV === 'production') {
        if (!secretKey || !webhookHash) {
            throw new Error(
                `Missing Flutterwave ${isLive ? 'LIVE' : 'TEST'} credentials. ` +
                `Ensure FLW_SECRET_KEY_${isLive ? 'LIVE' : 'TEST'} and ` +
                `FLW_WEBHOOK_HASH_${isLive ? 'LIVE' : 'TEST'} are set.`,
            );
        }

        if (bypassRequested) {
            throw new Error(
                'BYPASS_WEBHOOK_VERIFICATION must be false in production.',
            );
        }
    }

    return {
        isLive,
        env: isLive ? 'live' : 'test',
        secretKey: secretKey ?? '',
        publicKey: publicKey ?? '',
        webhookHash: webhookHash ?? '',
        baseUrl: process.env.FLW_BASE_URL ?? 'https://api.flutterwave.com/v3',

        // Dev safety valves — both must be explicitly false in production
        bypassWebhookVerification:
            process.env.NODE_ENV === 'production' ? false : bypassRequested,
        mockMode: process.env.MOCK_FLUTTERWAVE === 'true',

        // FLW's sandbox BVN — used for VA creation in test mode when user has no KYC BVN
        testBvn: '22222222222',
    };
});
