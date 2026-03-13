import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { KafkaService } from './kafka.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as fs from 'fs';

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
              clientId: configService.get<string>('KAFKA_CLIENT_ID', 'ajoti-api'),

              brokers: [
                configService.get<string>(
                  'KAFKA_BROKER',
                  'ajoti-kafka-1-ajoti-kafka.f.aivencloud.com:12178',
                ),
              ],

              ssl: {
                ca: [fs.readFileSync(configService.get('KAFKA_CA_PATH')!, 'utf8')],
              },

              sasl: {
                mechanism: 'plain',
                username: configService.get<string>('KAFKA_USERNAME')!,
                password: configService.get<string>('KAFKA_PASSWORD')!,
              },
            },

            consumer: {
              groupId: configService.get<string>('KAFKA_GROUP_ID', 'ajoti-consumer'),
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
