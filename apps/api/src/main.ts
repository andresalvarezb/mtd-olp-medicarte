import './telemetry';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Express } from 'express';
import { parseApiConfig } from '@authorization/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const config = parseApiConfig(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  if (config.NODE_ENV === 'production') {
    const express = app.getHttpAdapter().getInstance() as Express;
    express.set('trust proxy', 1);
  }
  app.useLogger(app.get(Logger));
  app.enableCors({ origin: config.WEB_ORIGIN });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const openApi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Authorization Platform API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build(),
  );
  SwaggerModule.setup('api/v1/docs', app, openApi, { jsonDocumentUrl: 'api/v1/openapi.json' });
  await app.listen(config.API_PORT, '0.0.0.0');
}

void bootstrap();
