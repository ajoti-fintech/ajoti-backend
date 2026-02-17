import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RedisModule, RedisThrottlerStorage, RedisToken } from '@nestjs-redis/kit';

import { HealthModule } from '@/modules/health/health.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { LoggerMiddleware } from '@/common/interceptors/logger.middleware';
import { appConfig } from '@/config/app.config';
import { WalletModule } from './modules/wallet/wallet.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MailModule } from './modules/mail/mail.module';
import { AppService } from './app.service';
import { KycController } from './modules/kyc/kyc.controller';
import { KycService } from './modules/kyc/kyc.service';
import { KycModule } from './modules/kyc/kyc.module';
import { UserIdThrottlerGuard } from './guard/userid-throttler.guard';
import { RoscaModule } from './modules/rosca/rosca.module';
import { ContributionModule } from './modules/contribution/contribution.module';
import { PayoutModule } from './modules/payout/payout.module';
import { TrustModule } from './modules/trust/trust.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { ScheduleModule } from '@nestjs/schedule';
import { FundingModule } from './modules/funding/funding.module';

const ENV = process.env.NODE_ENV || 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: [`.env.${ENV}.local`, `.env.${ENV}`, '.env.local', '.env'],
    }),

    //Redis-backed throttler (Redis connection lives inside this module scope)
    ThrottlerModule.forRootAsync({
      imports: [
        ScheduleModule.forRoot(),
        RedisModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const host = config.get<string>('REDIS_HOST', 'localhost');
            const port = config.get<number>('REDIS_PORT', 6379);
            const password = config.get<string>('REDIS_PASSWORD'); // optional

            const url = password
              ? `redis://:${encodeURIComponent(password)}@${host}:${port}`
              : `redis://${host}:${port}`;

            return { options: { url } };
          },
        }),
      ],
      inject: [RedisToken(), ConfigService],
      useFactory: (redis, config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('THROTTLE_TTL', 60_000),
            limit: config.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),

    PrismaModule,
    HealthModule,
    //  feature/ajoti-wallet-system
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
  ],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: UserIdThrottlerGuard,
    },
    KycService,
  ],
  controllers: [KycController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
