import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from '@/modules/health/health.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { LoggerMiddleware } from '@/common/interceptors/logger.middleware';
import { appConfig } from '@/config/app.config';
import { flutterwaveConfig } from '@/config/flutterwave.config'; // ← NEW
import { WalletModule } from './modules/wallet/wallet.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MailModule } from './modules/mail/mail.module';
import { AppService } from './app.service';
import { KycModule } from './modules/kyc/kyc.module';
import { UserIdThrottlerGuard } from './guard/userid-throttler.guard';
import { RoscaModule } from './modules/rosca/rosca.module';
import { ContributionModule } from './modules/contribution/contribution.module';
import { PayoutModule } from './modules/payout/payout.module';
import { TrustModule } from './modules/trust/trust.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { FundingModule } from './modules/funding/funding.module';
// import { KafkaModule } from './modules/kafka/kafka.module';
import { NotificationModule } from './modules/notification/notification.module';
import { WithdrawalModule } from './modules/withdrawal/withdrawal.module';
import { VirtualAccountModule } from './modules/virtual-accounts/virtual-account.module'; // ← NEW
import { OtpModule } from './modules/otp/otp.module';
import redisConfig from './config/redis.config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';

const ENV = process.env.NODE_ENV || 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, flutterwaveConfig, redisConfig], // ← flutterwaveConfig added
      envFilePath: [`.env.${ENV}.local`, `.env.${ENV}`, '.env.local', '.env'],
    }),

    ScheduleModule.forRoot(),

    // Inside AppModule imports...

BullModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const redisUrl = config.get('REDIS_URL');
    return {
      connection: redisUrl 
        ? { url: redisUrl } // Use full string on Render
        : {
            host: config.get('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
            password: config.get('REDIS_PASSWORD'),
          },
      maxRetriesPerRequest: null, // This fixes the 'MaxRetriesPerRequestError'
    };
  },
}),

ThrottlerModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => {
    const redisUrl = config.get('REDIS_URL');
    return {
      throttlers: [{
        ttl: config.get('THROTTLE_TTL', 60000),
        limit: config.get('THROTTLE_LIMIT', 100),
      }],
      // Fix: Use the URL string directly for the Throttler storage
      storage: redisUrl 
        ? new ThrottlerStorageRedisService(redisUrl)
        : new ThrottlerStorageRedisService({
            host: config.get('REDIS_HOST', 'localhost'),
            port: config.get('REDIS_PORT', 6379),
          }),
    };
  },
}),

    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    KycModule,
    WalletModule,
    WebhooksModule,
    MailModule,
    RoscaModule,
    ContributionModule,
    PayoutModule,
    TrustModule,
    TransactionsModule,
    FundingModule,
    // KafkaModule,
    NotificationModule,
    WithdrawalModule,
    VirtualAccountModule,
    OtpModule,
  ],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: UserIdThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*path');
  }
}
