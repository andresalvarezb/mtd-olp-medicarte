import * as Sentry from '@sentry/node';
import { Module } from '@nestjs/common';
import { parseWorkerConfig } from '@authorization/config';
import { createDatabase } from '@authorization/database';
import { DATABASE, WORKER_CONFIG } from './tokens';
import { WorkerService } from './worker.service';

const config = parseWorkerConfig(process.env);
if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const database = createDatabase(config.DATABASE_URL);

@Module({
  providers: [
    WorkerService,
    { provide: WORKER_CONFIG, useValue: config },
    { provide: DATABASE, useValue: database },
  ],
})
export class AppModule {}
