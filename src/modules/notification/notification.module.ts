import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationProcessor } from './notification.processor';
import { NotificationGateway } from './notification-gateway';
import { PrismaModule } from '@/prisma';
import { MailModule } from '../mail/mail.module';
import { AUTH_EVENTS_QUEUE } from '../auth/auth.events';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    BullModule.registerQueue({ name: AUTH_EVENTS_QUEUE }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  providers: [NotificationService, NotificationGateway, NotificationProcessor],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
