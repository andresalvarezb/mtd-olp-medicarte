import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { parseApiConfig } from '@authorization/config';
import { createDatabase } from '@authorization/database';
import Redis from 'ioredis';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { LoggerModule } from 'nestjs-pino';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { AuthGuard } from './common/auth.guard';
import { correlationMiddleware } from './common/correlation.middleware';
import { FoundationController } from './foundation/foundation.controller';
import { FoundationService } from './foundation/foundation.service';
import { AdminJobsController } from './foundation/admin-jobs.controller';
import { AccessService } from './identity/access.service';
import { AuthController } from './identity/auth.controller';
import { AuthService } from './identity/auth.service';
import { BootstrapAdminService } from './identity/bootstrap.service';
import { MeController } from './identity/me.controller';
import { UsersController } from './identity/users.controller';
import { UsersService } from './identity/users.service';
import { OperationsController } from './operations/operations.controller';
import { ClinicalModule } from './clinical/clinical.module';
import { PlanningPeriodController } from './planning/planning-period.controller';
import { PlanningPeriodRepository } from './planning/planning-period.repository';
import { PlanningPeriodService } from './planning/planning-period.service';
import { PatientScheduleController } from './scheduling/patient-schedule.controller';
import { PatientScheduleImportService } from './scheduling/patient-schedule-import.service';
import { PatientScheduleRepository } from './scheduling/patient-schedule.repository';
import { PatientScheduleService } from './scheduling/patient-schedule.service';
import { API_CONFIG, DATABASE, REDIS } from './tokens';

const config = parseApiConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'authorization_api_' });
const errors = new Counter({
  name: 'authorization_api_errors_total',
  help: 'Captured API errors',
  registers: [registry],
});
const duration = new Histogram({
  name: 'authorization_api_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method'],
  registers: [registry],
});
new Gauge({
  name: 'authorization_queue_jobs',
  help: 'BullMQ jobs by queue and state',
  labelNames: ['queue', 'state'],
  registers: [registry],
});

@Module({
  imports: [
    ClinicalModule.register(database),
    LoggerModule.forRoot({
      pinoHttp: {
        level: config.LOG_LEVEL,
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [
    AuthController,
    MeController,
    UsersController,
    OperationsController,
    AdminJobsController,
    PlanningPeriodController,
    PatientScheduleController,
    ...(config.NODE_ENV === 'production' ? [] : [FoundationController]),
  ],
  providers: [
    AuthGuard,
    AccessService,
    AuthService,
    BootstrapAdminService,
    UsersService,
    FoundationService,
    PlanningPeriodRepository,
    PlanningPeriodService,
    PatientScheduleRepository,
    PatientScheduleService,
    PatientScheduleImportService,
    { provide: API_CONFIG, useValue: config },
    { provide: DATABASE, useValue: database },
    { provide: REDIS, useValue: redis },
    { provide: Registry, useValue: registry },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        correlationMiddleware,
        (
          request: { method: string },
          response: { statusCode: number; on: (event: string, callback: () => void) => void },
          next: () => void,
        ) => {
          const end = duration.startTimer({ method: request.method });
          const span = trace.getTracer('authorization-api').startSpan(`HTTP ${request.method}`);
          response.on('finish', () => {
            end();
            if (response.statusCode >= 500) errors.inc();
            span.setStatus({
              code: response.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK,
            });
            span.end();
          });
          next();
        },
      )
      .forRoutes('*');
  }
}
