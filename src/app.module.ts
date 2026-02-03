import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RedisModule, RedisThrottlerStorage, RedisToken } from '@nestjs-redis/kit';

import { HealthModule } from '@/modules/health/health.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { LoggerMiddleware } from '@/common/interceptors/logger.middleware';
import { appConfig } from '@/config/app.config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MailModule } from './modules/mail/mail.module';
import { AppService } from './app.service';
import { KycController } from './modules/kyc/kyc.controller';
import { KycService } from './modules/kyc/kyc.service';
import { KycModule } from './modules/kyc/kyc.module';

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
            limit: config.get<number>('THROTTLE_LIMIT', 60),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),

    PrismaModule,
    HealthModule,
    MailModule,
    AuthModule,
    UsersModule,
    KycModule,
  ],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
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
