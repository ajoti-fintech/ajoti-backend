/* eslint-disable prettier/prettier */
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Transport } from '@nestjs/microservices';
import { join } from 'path';


async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Kafka microservice setup
  // app.connectMicroservice({
  //   transport: Transport.KAFKA,
  //   options: {
  //     client: {
  //       clientId: configService.get<string>('KAFKA_CLIENT_ID', 'ajoti-api'),
  //       brokers: [configService.get<string>('KAFKA_BROKERS', 'kafka:29092')],
  //     },
  //     consumer: {
  //       groupId: configService.get<string>('KAFKA_GROUP_ID', 'ajoti-consumer'),
  //     },
  //   },
  // });

  // Trust the first proxy hop so req.ip resolves to the real client IP
  // (required on Render, Railway, Heroku, and any reverse-proxy deployment)
  app.set('trust proxy', 1);

  app.useBodyParser('json', {
    verify: (req: any, _res: any, buf: Buffer) => {
      if (buf && buf.length) {
        req.rawBody = buf;
      }
    },
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // CORS configuration
  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN', '*'),
    credentials: true,
  });

  // Global prefix for all routes
  app.setGlobalPrefix('api', {
    exclude: ['health'],
  });

  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads'
  })

  const options = new DocumentBuilder()
    .setTitle('Ajoti Backend API')
    .setDescription('API documentation for the Ajoti backend service')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT token',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('PORT', 3000);
  // This middleware saves the raw buffer into 'req.rawBody'
  // before the JSON parser touches it.
  app.useBodyParser('json', {
    verify: (req: any, res: Response, buf: Buffer) => {
      if (buf && buf.length) {
        req.rawBody = buf;
      }
    },
  });

  // Start the Kafka microservice
  // await app.startAllMicroservices();
  // logger.log('Kafka microservice started');

  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Environment: ${configService.get<string>('NODE_ENV', 'development')}`);
}

bootstrap();
