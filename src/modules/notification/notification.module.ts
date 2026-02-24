import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { PrismaModule } from '@/prisma';
import { MailModule } from '../mail/mail.module';
import { NotificationConsumer } from './notification.consumer';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationGateway } from './notification-gateway';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET'),
      }),
    }),
  ],
  providers: [NotificationService, NotificationGateway],
  controllers: [NotificationConsumer, NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
