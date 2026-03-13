import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { KafkaService } from './kafka.service';
import { ConfigModule, ConfigService } from '@nestjs/config';

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
              brokers: [configService.get('KAFKA_BROKERS')!],
              // THIS SECTION IS JUST FOR TESTING ON RENDER USING AIVEN
              ssl: true, // Required for Aiven
              sasl: {
                mechanism: 'plain', // Aiven's standard
                username: configService.get('KAFKA_USERNAME', 'avnadmin'),
                password: configService.get('KAFKA_PASSWORD')!,
              },
              // SECTION END
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
