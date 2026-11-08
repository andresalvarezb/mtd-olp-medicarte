import * as Sentry from '@sentry/node';
import { Module } from '@nestjs/common';
import { parseWorkerConfig } from '@authorization/config';
import { createDatabase } from '@authorization/database';
import type { WorkerConfig } from '@authorization/config';
import { MtdomPatientLookupProcessor } from './mtdom-patient-lookup.processor';
import { MtdomPatientsReadClient } from './mtdom-patients-read.client';
import { DATABASE, PATIENT_LOOKUP_PROCESSOR, WORKER_CONFIG } from './tokens';
import { WorkerService } from './worker.service';

const config = parseWorkerConfig(process.env);
if (config.SENTRY_DSN) Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV });
const database = createDatabase(config.DATABASE_URL);

@Module({
  providers: [
    WorkerService,
    { provide: WORKER_CONFIG, useValue: config },
    { provide: DATABASE, useValue: database },
    {
      provide: PATIENT_LOOKUP_PROCESSOR,
      inject: [DATABASE, WORKER_CONFIG],
      useFactory: (patientDatabase: typeof database, workerConfig: WorkerConfig) => {
        if (
          !workerConfig.MTDOM_PATIENT_LOOKUP_ENABLED ||
          !workerConfig.MTDOM_DP07_APPROVED ||
          !workerConfig.MTDOM_PATIENT_IDENTITY_POLICY_VERSION ||
          !workerConfig.MTDOM_PATIENTS_API_TOKEN
        )
          return undefined;
        // The config schema requires both approval flags, a versioned identity
        // policy and a server-side token before this provider can be enabled.
        const policy = {
          version: workerConfig.MTDOM_PATIENT_IDENTITY_POLICY_VERSION,
          normalizeDocumentType: (value: string) => value,
          normalizeDocumentValue: (value: string) => value,
        };
        return new MtdomPatientLookupProcessor(
          patientDatabase,
          new MtdomPatientsReadClient({
            token: workerConfig.MTDOM_PATIENTS_API_TOKEN,
            timeoutMs: workerConfig.MTDOM_PATIENTS_TIMEOUT_MS,
          }),
          policy,
        );
      },
    },
    // Intentionally no PATIENT_CHANGES_SYNC_SCHEDULER provider: the documented
    // changes feed is global and has no approval to be consumed by this app.
    // Synthetic tests may inject a fake source and scheduler explicitly.
  ],
})
export class AppModule {}
