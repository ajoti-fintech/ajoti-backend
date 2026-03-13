import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { KafkaService } from './kafka.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { logLevel } from 'kafkajs';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'KAFKA_CLIENT',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: configService.get('KAFKA_CLIENT_ID', 'ajoti-api'),
              brokers: configService.get('KAFKA_BROKERS').split(','),

              // THIS SECTION IS JUST FOR TESTING ON RENDER USING AIVEN
              ssl: {
                rejectUnauthorized: true,
                ca: [fs.readFileSync(configService.get('KAFKA_CA_PATH')!, 'utf-8')],
              },
              sasl: {
                mechanism: 'scram-sha-256', 
                username: configService.get('KAFKA_USERNAME', 'avnadmin'),
                password: configService.get('KAFKA_PASSWORD')!,
              },
              // SECTION END
              logLevel: logLevel.DEBUG,
    logCreator: (level) => {
      return ({ namespace, label, log }) => {
        const { message, ...extra } = log;
        console.log(`[KAFKA_DEBUG] ${label}: ${message}`, JSON.stringify(extra));
      };
            },
            consumer: {
              groupId: configService.get('KAFKA_GROUP_ID', 'ajoti-consumer'),
            },
          },
        }),
      },
    ]),
  ],
  providers: [KafkaService],
  exports: [KafkaService, ClientsModule],
})
export class KafkaModule {}
