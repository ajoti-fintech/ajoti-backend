import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService, ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from '@/modules/health/health.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { LoggerMiddleware } from '@/common/interceptors/logger.middleware';
import { appConfig } from '@/config/app.config';
import { flutterwaveConfig } from '@/config/flutterwave.config';
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
import { NotificationModule } from './modules/notification/notification.module';
import { WithdrawalModule } from './modules/withdrawal/withdrawal.module';
import { VirtualAccountModule } from './modules/virtual-accounts/virtual-account.module'; // ← NEW
import { OtpModule } from './modules/otp/otp.module';
import { CreditModule } from './modules/credit/credit.module';
import { LoanModule } from './modules/loans/loans.module';
import { PeerReviewModule } from './modules/peer-review/peer-review.module';
import { SimulationModule } from './modules/simulation/simulation.module';
import { SuperadminModule } from './modules/superadmin/superadmin.module';
import redisConfig from './config/redis.config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { RedisOptions } from 'ioredis';

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
      inject: [redisConfig.KEY],
      useFactory: (redis: ConfigType<typeof redisConfig>) => {
        return {
          connection: redis.connection,
          maxRetriesPerRequest: null, // This fixes the 'MaxRetriesPerRequestError'
        };
      },
    }),

    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, redisConfig.KEY],
      useFactory: (config: ConfigService, redis: ConfigType<typeof redisConfig>) => {
        return {
          throttlers: [
            {
              ttl: config.get('THROTTLE_TTL', 60000),
              limit: config.get('THROTTLE_LIMIT', 100),
            },
          ],
          storage:
            typeof redis.storage === 'string'
              ? new ThrottlerStorageRedisService(redis.storage)
              : new ThrottlerStorageRedisService(redis.storage as RedisOptions),
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
    CreditModule,
    LoanModule,
    PeerReviewModule,
    SimulationModule,
    SuperadminModule,
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
