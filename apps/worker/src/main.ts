import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule);
  application.enableShutdownHooks();
}

void bootstrap();
