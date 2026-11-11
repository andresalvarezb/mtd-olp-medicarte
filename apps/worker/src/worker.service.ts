import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { Inject, Injectable, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { WorkerConfig } from '@authorization/config';
import {
  FOUNDATION_DEAD_LETTER_QUEUE,
  PATIENT_MASTER_LIVE_LOOKUP_CHANNEL,
  FOUNDATION_JOB_NAME,
  FOUNDATION_JOB_OPTIONS,
  FOUNDATION_QUEUE,
  PATIENT_LOOKUP_JOB_NAME,
  PATIENT_LOOKUP_JOB_OPTIONS,
  PATIENT_LOOKUP_OUTBOX_EVENT_TYPE,
  REALTIME_OUTBOX_EVENT_TYPE,
  REALTIME_REDIS_CHANNEL,
  foundationJobSchema,
  patientLookupJobSchema,
  patientLookupOutboxPayloadSchema,
  patientMasterLiveLookupWorkerRequestSchema,
  realtimeInvalidationMessageSchema,
  realtimeOutboxPayloadSchema,
  type FoundationJob,
  type PatientLookupJob,
} from '@authorization/contracts';
import { jobResults, outboxEvents } from '@authorization/database';
import type { createDatabase } from '@authorization/database';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import pino from 'pino';
import { DATABASE, PATIENT_LOOKUP_SYNC_SCHEDULER, PATIENT_LOOKUP_PROCESSOR, WORKER_CONFIG } from './tokens';
import { PatientLocalLookupSyncScheduler } from './patient-local-lookup-sync';
import {
  runInventoryExpirationReleaseSweep,
} from './inventory-expiration-release';
import {
  PatientLookupRetryableError,
  processPatientLookupJob,
  type PatientLookupProcessor,
} from './patient-lookup-processing';

import {
  AuthorizationDriveSupportSync,
} from './authorization-drive-support-sync';

type Database = ReturnType<typeof createDatabase>;
type WorkerJob = FoundationJob | PatientLookupJob;
type OutboxRow = {
  id: string;
  event_type: string;
  version: number;
  payload: unknown;
  correlation_id: string;
  organization_id: string | null;
  idempotency_key: string;
  created_at: Date | string;
};
type FoundationDeadLetterJob = {
  sourceQueue: string;
  sourceJobId: string;
  jobName: string;
  payload: FoundationJob;
  failedReason: string;
  failedAt: string;
};
type PatientLookupDeadLetterJob = {
  sourceQueue: string;
  sourceJobId: string;
  jobName: string;
  payload: { eventId: string };
  failedReason: 'PATIENT_LOOKUP_RETRYABLE_FAILURE';
  failedAt: string;
};
type DeadLetterJob = FoundationDeadLetterJob | PatientLookupDeadLetterJob;


function currentBogotaDate(): string {
  const parts =
    new Intl.DateTimeFormat(
      'en-US',
      {
        timeZone:
          'America/Bogota',

        year:
          'numeric',

        month:
          '2-digit',

        day:
          '2-digit',
      },
    ).formatToParts(
      new Date(),
    );

  const value = (
    type: string,
  ) =>
    parts.find(
      (part) =>
        part.type === type,
    )?.value ?? '';

  return [
    value('year'),
    value('month'),
    value('day'),
  ].join(
    '-',
  );
}


@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger: pino.Logger;
  private readonly connection: IORedis;
  private readonly patientMasterLookupSubscriber: IORedis;
  private readonly queue: Queue<WorkerJob>;
  private readonly deadLetterQueue: Queue<DeadLetterJob>;
  private readonly queueEvents: QueueEvents;
  private readonly worker: Worker<WorkerJob>;
  private timer?: NodeJS.Timeout;

  private expirationSweepTimer?:
    NodeJS.Timeout;

  private driveSupportSyncTimer?:
    NodeJS.Timeout;

  private readonly driveSupportSync:
    AuthorizationDriveSupportSync;

  private driveSupportSyncRunning =
    false;

  private expirationSweeping =
    false;

  private dispatching = false;

  private readonly patientLookupInFlight = new Map<string, Promise<{ processed: boolean }>>();

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(DATABASE) private readonly database: Database,
    @Optional()
    @Inject(PATIENT_LOOKUP_PROCESSOR)
    private readonly patientLookupProcessor?: PatientLookupProcessor,
    @Optional()
    @Inject(PATIENT_LOOKUP_SYNC_SCHEDULER)
    private readonly patientLookupSyncScheduler?: PatientLocalLookupSyncScheduler,
  ) {
    this.logger = pino({ level: config.LOG_LEVEL, base: { service: 'platform-worker' } });
    this.connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.patientMasterLookupSubscriber = this.connection.duplicate({ maxRetriesPerRequest: null });
    this.queue = new Queue(FOUNDATION_QUEUE, { connection: this.connection });
    this.deadLetterQueue = new Queue(FOUNDATION_DEAD_LETTER_QUEUE, {
      connection: this.connection,
    });
    this.queueEvents = new QueueEvents(FOUNDATION_QUEUE, { connection: this.connection });
    this.worker = new Worker(FOUNDATION_QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 5,
      settings: {
        backoffStrategy: (attemptsMade, type, error) => {
          if (type !== 'patient-lookup') return -1;
          const exponentialDelay = 500 * 2 ** Math.max(0, attemptsMade - 1);
          const retryAfterMs = error instanceof PatientLookupRetryableError
            ? error.retryAfterMs ?? 0
            : 0;
          const minimumDelay = Math.min(5 * 60 * 1000, Math.max(exponentialDelay, retryAfterMs));
          return Math.min(5 * 60 * 1000, minimumDelay + Math.floor(Math.random() * Math.max(1, minimumDelay * 0.2)));
        },
      },
    });

    this.driveSupportSync =
      new AuthorizationDriveSupportSync(
        config,
        database,
        this.logger,
      );
  }

  onModuleInit(): void {
    this.patientMasterLookupSubscriber.on('message', (channel, raw) => {
      if (channel === PATIENT_MASTER_LIVE_LOOKUP_CHANNEL) {
        void this.handlePatientMasterLiveLookup(raw);
      }
    });
    void this.patientMasterLookupSubscriber.subscribe(
      PATIENT_MASTER_LIVE_LOOKUP_CHANNEL,
    );
    this.worker.on('error', (error) => {
      this.logger.error({ error }, 'worker error');
      Sentry.captureException(error);
    });
    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.moveToDeadLetter(jobId, failedReason).catch((error) => {
        this.reportBackgroundTaskError(error, 'failed to move worker job to dead letter queue');
      });
    });
    if (this.config.SCHEDULER_ENABLED) {
      if (this.config.MTDOM_PATIENT_LOOKUP_SYNC_ENABLED && this.patientLookupSyncScheduler) {
        this.patientLookupSyncScheduler.startDailyAt(
          9,
          0,
          'America/Bogota',
          (error) => this.reportBackgroundTaskError(error, 'patient local lookup sync failed'),
        );
      }
      this.timer = setInterval(
        () => void this.dispatchOutbox(),
        this.config.OUTBOX_POLL_INTERVAL_MS,
      );
      void this.dispatchOutbox();

      /*
       * Vencimiento de autorizaciones:
       *
       * se ejecuta inmediatamente al iniciar
       * el worker y luego cada 5 minutos.
       *
       * El helper es idempotente y usa
       * advisory lock transaccional.
       */
      this.expirationSweepTimer =
        setInterval(
          () =>
            void this.runExpirationSweep(),
          5 * 60 * 1000,
        );

      void this.runExpirationSweep();


      if (
        this.config
          .GOOGLE_DRIVE_AUDIT_SYNC_ENABLED
      ) {
        this.driveSupportSyncTimer =
          setInterval(
            () =>
              void this.runDriveSupportSync(),

            this.config
              .GOOGLE_DRIVE_AUDIT_SYNC_POLL_INTERVAL_MS,
          );


        /*
         * Ejecutamos inmediatamente para que el
         * backfill comience después del deploy.
         *
         * El procesamiento permanece limitado por
         * batch + concurrencia.
         */
        void this.runDriveSupportSync();
      }
    }
  }

  private async handlePatientMasterLiveLookup(raw: string): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    const parsed = patientMasterLiveLookupWorkerRequestSchema.safeParse(payload);
    if (!parsed.success) return;
    const identity = {
      documentType: parsed.data.identificationType,
      documentValue: parsed.data.identificationValue,
    };
    const result = this.patientLookupProcessor?.lookupLiveWithResponse
      ? await Promise.race([
          this.patientLookupProcessor
            .lookupLiveWithResponse(identity)
            .catch(() => ({ status: 'UNAVAILABLE' as const })),
          new Promise<{ status: 'UNAVAILABLE' }>((resolve) =>
            setTimeout(() => resolve({ status: 'UNAVAILABLE' }), 18_000),
          ),
        ])
      : { status: 'UNAVAILABLE' as const };
    await this.connection.publish(
      parsed.data.responseChannel,
      JSON.stringify({
        requestId: parsed.data.requestId,
        status: result.status,
        ...(result.status === 'FOUND' ? { basicProfile: result.basicProfile } : {}),
      }),
    );
  }


  private async runDriveSupportSync():
    Promise<void> {
    if (
      this.driveSupportSyncRunning
    ) {
      return;
    }


    this.driveSupportSyncRunning =
      true;


    try {
      await this.driveSupportSync.run();
    } catch (
      error
    ) {
      this.logger.error(
        {
          error,
        },
        'authorization drive support sync failed',
      );


      Sentry.captureException(
        error,
      );
    } finally {
      this.driveSupportSyncRunning =
        false;
    }
  }


  private async runExpirationSweep(): Promise<void> {
    if (
      this.expirationSweeping
    ) {
      return;
    }

    this.expirationSweeping =
      true;

    try {
      const today =
        currentBogotaDate();

      const result =
        await runInventoryExpirationReleaseSweep(
          this.database,
          today,
        );

      if (
        result.expiredAuthorizations > 0
        ||
        result.releasedAllocations > 0
      ) {
        this.logger.info(
          {
            today,

            expiredAuthorizations:
              result.expiredAuthorizations,

            releasedAllocations:
              result.releasedAllocations,

            releasedQuantity:
              result.releasedQuantity,

            releasedPurchaseOrderSources:
              result.releasedPurchaseOrderSources,

            releasedPurchaseSourceSnapshotQuantity:
              result.releasedPurchaseSourceSnapshotQuantity,

            clearedAuthorizations:
              result.clearedAuthorizations,
          },
          'authorization expiration inventory sweep applied',
        );
      }
    } catch (
      error
    ) {
      this.logger.error(
        {
          error,
        },
        'authorization expiration inventory sweep failed',
      );

      Sentry.captureException(
        error,
      );
    } finally {
      this.expirationSweeping =
        false;
    }
  }

  private async dispatchOutbox(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      for (let index = 0; index < 20; index += 1) {
        if (!(await this.dispatchNextEvent())) break;
      }
    } catch (error) {
      this.reportBackgroundTaskError(error, 'outbox dispatch failed');
    } finally {
      this.dispatching = false;
    }
  }

  private async dispatchNextEvent(): Promise<boolean> {
    const client = await this.database.pool.connect();
    let patientEvent = false;
    let connectionError: Error | boolean | undefined;
    let transactionOpen = false;
    const onClientError = (error: Error) => {
      connectionError = error;
    };
    client.on('error', onClientError);
    const commit = async () => {
      await client.query('commit');
      transactionOpen = false;
    };
    try {
      await client.query('begin');
      transactionOpen = true;
      const result = await client.query<OutboxRow>(
        `select id, event_type, version, payload, correlation_id, organization_id,
                idempotency_key, created_at
         from outbox_events
         where (status = 'PENDING' or (status = 'DISPATCHED' and dispatched_at < now() - interval '30 seconds'))
           and available_at <= now()
         order by created_at
         limit 1
         for update skip locked`,
      );
      const event = result.rows[0];
      if (!event) {
        await commit();
        return false;
      }

      if (event.event_type === REALTIME_OUTBOX_EVENT_TYPE) {
        const realtime = realtimeOutboxPayloadSchema.safeParse(event.payload);

        if (!realtime.success || event.version !== 1 || !event.organization_id) {
          await client.query(
            `update outbox_events
             set status = 'FAILED', attempts = attempts + 1,
                 last_error = 'Invalid realtime invalidation event'
             where id = $1`,
            [event.id],
          );
          await commit();
          return true;
        }

        const message = realtimeInvalidationMessageSchema.parse({
          eventId: event.id,
          type: REALTIME_OUTBOX_EVENT_TYPE,
          version: 1,
          organizationId: event.organization_id,
          topics: realtime.data.topics,
          resource: realtime.data.resource ?? null,
          correlationId: event.correlation_id,
          occurredAt: new Date(event.created_at).toISOString(),
        });

        await this.connection.publish(REALTIME_REDIS_CHANNEL, JSON.stringify(message));
        await client.query(
          `update outbox_events
           set status = 'PROCESSED', attempts = attempts + 1,
               dispatched_at = coalesce(dispatched_at, now()),
               processed_at = now(), last_error = null
           where id = $1`,
          [event.id],
        );
        await commit();
        return true;
      }

      let parsedJob: WorkerJob;
      let queueJobName: string;
      let queueJobOptions: typeof FOUNDATION_JOB_OPTIONS | typeof PATIENT_LOOKUP_JOB_OPTIONS;
      if (event.event_type === PATIENT_LOOKUP_OUTBOX_EVENT_TYPE) {
        patientEvent = true;
        const outboxPayload = patientLookupOutboxPayloadSchema.safeParse(event.payload);
        const patientJob = patientLookupJobSchema.safeParse({
          name: event.event_type,
          version: event.version,
          payload: {
            eventId: event.id,
            patientId: outboxPayload.success ? outboxPayload.data.patientId : undefined,
          },
          correlationId: event.correlation_id,
          idempotencyKey: event.idempotency_key,
        });
        if (!outboxPayload.success || event.version !== 1 || !patientJob.success) {
          await client.query(
            `update outbox_events
             set status = 'FAILED', attempts = attempts + 1,
                 last_error = 'PATIENT_LOOKUP_INVALID_EVENT'
             where id = $1`,
            [event.id],
          );
          await commit();
          return true;
        }
        parsedJob = patientJob.data;
        queueJobName = PATIENT_LOOKUP_JOB_NAME;
        queueJobOptions = PATIENT_LOOKUP_JOB_OPTIONS;
      } else {
        const foundationJob = foundationJobSchema.safeParse({
          name: event.event_type,
          version: event.version,
          payload: event.payload,
          correlationId: event.correlation_id,
          idempotencyKey: event.idempotency_key,
        });
        if (!foundationJob.success) {
          await client.query(
            `update outbox_events
             set status = 'FAILED', attempts = attempts + 1,
                 last_error = 'Unsupported legacy event; no active processor'
             where id = $1`,
            [event.id],
          );
          await commit();
          return true;
        }
        parsedJob = foundationJob.data;
        queueJobName = FOUNDATION_JOB_NAME;
        queueJobOptions = FOUNDATION_JOB_OPTIONS;
      }

      const persisted = await client.query(
        'select 1 from job_results where queue = $1 and idempotency_key = $2',
        [FOUNDATION_QUEUE, parsedJob.idempotencyKey],
      );
      if (persisted.rowCount) {
        await client.query(
          `update outbox_events set status = 'PROCESSED', processed_at = now(), last_error = null where id = $1`,
          [event.id],
        );
        await commit();
        return true;
      }

      const jobId = createHash('sha256')
        .update(`${FOUNDATION_QUEUE}:${parsedJob.idempotencyKey}`)
        .digest('hex');
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'failed' || state === 'completed') {
          const failure = parsedJob.name === 'patient.lookup'
            ? state === 'failed'
              ? 'PATIENT_LOOKUP_RETRYABLE_FAILURE'
              : 'PATIENT_LOOKUP_COMPLETED_WITHOUT_RESULT'
            : state === 'failed'
              ? existingJob.failedReason
              : 'Completed queue job has no persistent result';
          await client.query(
            `update outbox_events set status = 'FAILED', last_error = $2 where id = $1`,
            [event.id, failure],
          );
          await commit();
          return true;
        }
      } else {
        await this.queue.add(queueJobName, parsedJob, { ...queueJobOptions, jobId });
      }
      await client.query(
        `update outbox_events
         set status = 'DISPATCHED', dispatched_at = now(), attempts = attempts + 1
         where id = $1`,
        [event.id],
      );
      await commit();
      return true;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('rollback');
          transactionOpen = false;
        } catch (rollbackError) {
          connectionError = true;
          this.logger.error({ error: rollbackError }, 'outbox transaction rollback failed');
        }
      }
      if (patientEvent) {
        this.logger.error({ code: 'PATIENT_LOOKUP_DISPATCH_FAILURE' }, 'patient event dispatch failed');
      } else {
        this.logger.error({ error }, 'outbox dispatch failed');
        Sentry.captureException(error);
      }
      return false;
    } finally {
      client.removeListener('error', onClientError);
      if (connectionError) client.release(connectionError);
      else client.release();
    }
  }

  private reportBackgroundTaskError(error: unknown, message: string): void {
    this.logger.error({ error }, message);
    Sentry.captureException(error);
  }

  private async process(rawJob: Job<WorkerJob>): Promise<{ processed: boolean }> {
    if (rawJob.data.name === 'patient.lookup') {
      const job = patientLookupJobSchema.parse(rawJob.data);
      const inFlight = this.patientLookupInFlight.get(job.idempotencyKey);
      if (inFlight) return inFlight;

      const processing = this.processPatientLookup(job);
      this.patientLookupInFlight.set(job.idempotencyKey, processing);
      try {
        return await processing;
      } finally {
        if (this.patientLookupInFlight.get(job.idempotencyKey) === processing) {
          this.patientLookupInFlight.delete(job.idempotencyKey);
        }
      }
    }

    const job = foundationJobSchema.parse(rawJob.data);
    await this.database.db
      .insert(jobResults)
      .values({
        queue: FOUNDATION_QUEUE,
        jobName: FOUNDATION_JOB_NAME,
        idempotencyKey: job.idempotencyKey,
        result: { eventId: job.payload.eventId, message: job.payload.message },
        correlationId: job.correlationId,
      })
      .onConflictDoNothing();
    await this.database.db
      .update(outboxEvents)
      .set({ status: 'PROCESSED', processedAt: new Date(), lastError: null })
      .where(eq(outboxEvents.id, job.payload.eventId));
    return { processed: true };
  }

  private async processPatientLookup(job: PatientLookupJob): Promise<{ processed: boolean }> {
    const startedAt = Date.now();
    try {
      const result = await processPatientLookupJob(this.database, this.patientLookupProcessor, job);
      const outcome = result.outcome ?? (
        result.terminalCode
          ? 'TERMINAL_FAILURE'
          : result.deduplicated
            ? 'DEDUPLICATED'
            : result.processed
              ? 'PROCESSED'
              : 'NOT_PROCESSED'
      );
      const metrics = {
        outcome,
        durationMs: Date.now() - startedAt,
        ...(result.terminalCode ? { code: result.terminalCode } : {}),
      };
      if (result.terminalCode) {
        this.logger.error(metrics, 'patient lookup stopped in a terminal state');
      } else {
        this.logger.info(metrics, 'patient lookup processed');
      }
      return result;
    } catch (error) {
      this.logger.warn(
        {
          code: 'PATIENT_LOOKUP_RETRYABLE_FAILURE',
          durationMs: Date.now() - startedAt,
          ...(error instanceof PatientLookupRetryableError && error.retryAfterMs !== undefined
            ? { retryAfterMs: error.retryAfterMs }
            : {}),
        },
        'patient lookup will retry',
      );
      if (error instanceof PatientLookupRetryableError) throw error;
      throw new PatientLookupRetryableError();
    }
  }

  private async moveToDeadLetter(jobId: string, failedReason: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;

    const patient = patientLookupJobSchema.safeParse(job.data);
    if (patient.success) {
      const safeReason = 'PATIENT_LOOKUP_RETRYABLE_FAILURE' as const;
      await this.database.db
        .update(outboxEvents)
        .set({ status: 'FAILED', lastError: safeReason })
        .where(eq(outboxEvents.id, patient.data.payload.eventId));
      await this.deadLetterQueue.add(
        'dead-letter.v1',
        {
          sourceQueue: FOUNDATION_QUEUE,
          sourceJobId: jobId,
          jobName: job.name,
          payload: { eventId: patient.data.payload.eventId },
          failedReason: safeReason,
          failedAt: new Date().toISOString(),
        },
        { jobId: `dlq-${jobId}`, removeOnComplete: false, removeOnFail: false },
      );
      return;
    }

    const parsed = foundationJobSchema.safeParse(job.data);
    if (!parsed.success) return;
    await this.database.db
      .update(outboxEvents)
      .set({ status: 'FAILED', lastError: failedReason })
      .where(eq(outboxEvents.id, parsed.data.payload.eventId));
    await this.deadLetterQueue.add(
      'dead-letter.v1',
      {
        sourceQueue: FOUNDATION_QUEUE,
        sourceJobId: jobId,
        jobName: job.name,
        payload: parsed.data,
        failedReason,
        failedAt: new Date().toISOString(),
      },
      { jobId: `dlq-${jobId}`, removeOnComplete: false, removeOnFail: false },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.patientLookupSyncScheduler?.stop();
    if (
      this.timer
    ) {
      clearInterval(
        this.timer,
      );
    }

    if (
      this.expirationSweepTimer
    ) {
      clearInterval(
        this.expirationSweepTimer,
      );
    }


    if (
      this.driveSupportSyncTimer
    ) {
      clearInterval(
        this.driveSupportSyncTimer,
      );
    }


    await this.worker.close();
    await this.patientMasterLookupSubscriber.unsubscribe(PATIENT_MASTER_LIVE_LOOKUP_CHANNEL);
    await this.patientMasterLookupSubscriber.quit();
    await this.queueEvents.close();
    await this.queue.close();
    await this.deadLetterQueue.close();
    await this.connection.quit();
    await this.database.pool.end();
  }
}
