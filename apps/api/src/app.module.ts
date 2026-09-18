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
import { ModuleRegistryController } from './identity/module-registry.controller';
import { RoleAccessController } from './identity/role-access.controller';
import { RoleAccessService } from './identity/role-access.service';
import { UsersController } from './identity/users.controller';
import { UsersService } from './identity/users.service';
import { OperationsController } from './operations/operations.controller';
import { ClinicalModule } from './clinical/clinical.module';
import { ProjectedDemandController } from './consolidation/projected-demand.controller';
import { ProjectedDemandRepository } from './consolidation/projected-demand.repository';
import { ProjectedDemandService } from './consolidation/projected-demand.service';
import { PlanningPeriodController } from './planning/planning-period.controller';
import { PlanningPeriodRepository } from './planning/planning-period.repository';
import { PlanningPeriodService } from './planning/planning-period.service';
import { PatientScheduleController } from './scheduling/patient-schedule.controller';
import { PatientScheduleImportService } from './scheduling/patient-schedule-import.service';
import { PatientScheduleRepository } from './scheduling/patient-schedule.repository';
import { PatientScheduleService } from './scheduling/patient-schedule.service';
import { API_CONFIG, DATABASE, REDIS } from './tokens';
import {
  PurchaseOrderController,
  SupplierPurchaseOrderController,
} from './purchase-orders/purchase-order.controller';
import { PurchaseOrderService } from './purchase-orders/purchase-order.service';
import { PurchaseOrderRepository } from './purchase-orders/purchase-order.repository';
import { DeliveryController, MedicarteDeliveryController } from './deliveries/delivery.controller';
import { DeliveryRepository } from './deliveries/delivery.repository';
import { DeliveryService } from './deliveries/delivery.service';
import { ReceiptController, OlpReceiptController } from './receipts/receipt.controller';
import { ReceiptRepository } from './receipts/receipt.repository';
import { ReceiptService } from './receipts/receipt.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryRepository } from './inventory/inventory.repository';
import { InventoryService } from './inventory/inventory.service';
import { StockTransferController } from './inventory/stock-transfer.controller';
import { StockTransferRepository } from './inventory/stock-transfer.repository';
import { StockTransferService } from './inventory/stock-transfer.service';
import { PatientApplicationController } from './applications/patient-application.controller';
import { PatientApplicationRepository } from './applications/patient-application.repository';
import { PatientApplicationService } from './applications/patient-application.service';
import { PatientOutcomeController } from './outcomes/patient-outcome.controller';
import { PatientOutcomeRepository } from './outcomes/patient-outcome.repository';
import { PatientOutcomeService } from './outcomes/patient-outcome.service';
import { PatientApplicationAuditController } from './audits/patient-application-audit.controller';
import { PatientApplicationAuditRepository } from './audits/patient-application-audit.repository';
import { PatientApplicationAuditService } from './audits/patient-application-audit.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsRepository } from './analytics/analytics.repository';
import { AnalyticsService } from './analytics/analytics.service';
import { BulkImportController } from './bulk-imports/bulk-import.controller';
import { BulkImportRepository } from './bulk-imports/bulk-import.repository';
import { BulkImportService } from './bulk-imports/bulk-import.service';
import { TariffAnnexRepository } from './tariff-annex/tariff-annex.repository';
import { TariffAnnexService } from './tariff-annex/tariff-annex.service';
import { TariffAnnexController } from './tariff-annex/tariff-annex.controller';
import { AccessScopeController } from './access-scopes/access-scope.controller';
import { OperationalAccessScopeService } from './access-scopes/operational-access-scope.service';
import { LegacyAuthorizationHistoryRepository } from './legacy/legacy-authorization-history.repository';
import { LegacyCompatibilityProjectionService } from './legacy/legacy-compatibility-projection.service';
import { ReconciliationController } from './reconciliation/reconciliation.controller';
import { ReconciliationIssuesRepository } from './reconciliation/reconciliation-issues.repository';
import { ReconciliationIssuesService } from './reconciliation/reconciliation-issues.service';
import { ReconciliationOperationsRepository } from './reconciliation/reconciliation-operations.repository';
import { ReconciliationOperationsService } from './reconciliation/reconciliation-operations.service';
import { ReconciliationSchedulerWorker } from './reconciliation/reconciliation-scheduler.worker';
import { ReconciliationMetricsProvider } from './reconciliation/reconciliation.metrics';
import { ReconciliationRepository } from './reconciliation/reconciliation.repository';
import { ReconciliationService } from './reconciliation/reconciliation.service';

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
    // Integration/dev uses an explicit higher ceiling so the serialized gate
    // suite is deterministic; production keeps the security default.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: Number(
          process.env.THROTTLE_GLOBAL_LIMIT ?? (config.NODE_ENV === 'production' ? 100 : 1000),
        ),
      },
    ]),
  ],
  controllers: [
    AuthController,
    MeController,
    ModuleRegistryController,
    RoleAccessController,
    UsersController,
    OperationsController,
    AdminJobsController,
    PlanningPeriodController,
    PatientScheduleController,
    ProjectedDemandController,
    PurchaseOrderController,
    SupplierPurchaseOrderController,
    DeliveryController,
    MedicarteDeliveryController,
    ReceiptController,
    OlpReceiptController,
    InventoryController,
    StockTransferController,
    PatientApplicationController,
    PatientOutcomeController,
    PatientApplicationAuditController,
    AnalyticsController,
    BulkImportController,
    TariffAnnexController,
    AccessScopeController,
    ReconciliationController,
    ...(config.NODE_ENV === 'production' ? [] : [FoundationController]),
  ],
  providers: [
    AuthGuard,
    AccessService,
    AuthService,
    BootstrapAdminService,
    RoleAccessService,
    UsersService,
    FoundationService,
    PlanningPeriodRepository,
    PlanningPeriodService,
    PatientScheduleRepository,
    PatientScheduleService,
    PatientScheduleImportService,
    ProjectedDemandRepository,
    ProjectedDemandService,
    PurchaseOrderRepository,
    PurchaseOrderService,
    DeliveryRepository,
    DeliveryService,
    ReceiptRepository,
    ReceiptService,
    InventoryRepository,
    InventoryService,
    StockTransferRepository,
    StockTransferService,
    PatientApplicationRepository,
    PatientApplicationService,
    PatientOutcomeRepository,
    PatientOutcomeService,
    PatientApplicationAuditRepository,
    PatientApplicationAuditService,
    LegacyAuthorizationHistoryRepository,
    LegacyCompatibilityProjectionService,
    AnalyticsRepository,
    AnalyticsService,
    BulkImportRepository,
    BulkImportService,
    TariffAnnexRepository,
    TariffAnnexService,
    OperationalAccessScopeService,
    ReconciliationRepository,
    ReconciliationService,
    ReconciliationIssuesRepository,
    ReconciliationIssuesService,
    ReconciliationOperationsRepository,
    ReconciliationOperationsService,
    ReconciliationSchedulerWorker,
    ReconciliationMetricsProvider,
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
