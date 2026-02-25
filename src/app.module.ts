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
import { WithdrawalModule } from './modules/withdrawal/withdrawal.module';
import { VirtualAccountModule } from './modules/virtual-accounts/virtual-account.module'; // ← NEW

const ENV = process.env.NODE_ENV || 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, flutterwaveConfig], // ← flutterwaveConfig added
      envFilePath: [`.env.${ENV}.local`, `.env.${ENV}`, '.env.local', '.env'],
    }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('THROTTLE_TTL', 60_000),
            limit: config.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
      }),
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
    WithdrawalModule,
    VirtualAccountModule,
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