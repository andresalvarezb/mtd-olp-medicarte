import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { WorkerConfig } from '@authorization/config';
import {
  authorizationImportJobSchema,
  BULK_UPDATES_DEAD_LETTER_QUEUE,
  BULK_UPDATE_JOB_NAME,
  BULK_UPDATE_JOB_OPTIONS,
  BULK_UPDATES_QUEUE,
  bulkUpdateJobSchema,
  FOUNDATION_DEAD_LETTER_QUEUE,
  FOUNDATION_JOB_NAME,
  FOUNDATION_JOB_OPTIONS,
  FOUNDATION_QUEUE,
  foundationJobSchema,
  IMPORT_DEAD_LETTER_QUEUE,
  IMPORT_JOB_NAME,
  IMPORT_JOB_OPTIONS,
  IMPORT_QUEUE,
  MIPRES_DEAD_LETTER_QUEUE,
  MIPRES_JOB_NAME,
  MIPRES_JOB_OPTIONS,
  MIPRES_QUEUE,
  mipresRecheckJobSchema,
  TARIFF_ANNEX_DEAD_LETTER_QUEUE,
  TARIFF_ANNEX_QUEUE,
  TARIFF_IMPORT_JOB_NAME,
  TARIFF_JOB_OPTIONS,
  TARIFF_REVALIDATION_JOB_NAME,
  tariffAnnexRevalidationJobSchema,
  tariffImportJobSchema,
  type AuthorizationImportJob,
  type BulkUpdateJob,
  type FoundationJob,
  type MipresRecheckJob,
  type TariffAnnexRevalidationJob,
  type TariffImportJob,
} from '@authorization/contracts';
import { currentBogotaDate, type MipresPort } from '@authorization/domain';
import { jobResults, outboxEvents } from '@authorization/database';
import type { createDatabase } from '@authorization/database';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import pino from 'pino';
import { DATABASE, WORKER_CONFIG } from './tokens';
import { classifyTerminalImportError, NonRetryableImportError } from './imports/import-errors';
import { ImportProcessor, type ImportProcessingResult } from './imports/import-processor';
import { persistTerminalImportFailure } from './imports/import-terminal-failure';
import { MipresProcessor, type MipresProcessingResult } from './mipres/mipres-processor';
import { MipresHttpAdapter } from './mipres/mipres-http-adapter';
import { MipresNotConfiguredPort, MipresTokenProvider } from './mipres/mipres-token-provider';
import { BulkUpdateProcessor, type BulkProcessingResult } from './bulk/bulk-processor';
import {
  TariffImportProcessor,
  type TariffImportProcessingResult,
} from './tariff/tariff-import-processor';
import {
  TariffRevalidationProcessor,
  type TariffRevalidationResult,
} from './tariff/tariff-revalidation-processor';

type Database = ReturnType<typeof createDatabase>;
type WorkerJob =
  | FoundationJob
  | AuthorizationImportJob
  | MipresRecheckJob
  | BulkUpdateJob
  | TariffImportJob
  | TariffAnnexRevalidationJob;
type QueueJob = WorkerJob;
type OutboxRow = {
  id: string;
  event_type: string;
  version: number;
  payload: unknown;
  correlation_id: string;
  idempotency_key: string;
};
type DeadLetterJob = {
  sourceQueue: string;
  sourceJobId: string;
  jobName: string;
  payload: WorkerJob;
  failedReason: string;
  failedAt: string;
};

@Injectable()
export class WorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger: pino.Logger;
  private readonly connection: IORedis;
  private readonly foundationQueue: Queue<FoundationJob>;
  private readonly importQueue: Queue<AuthorizationImportJob>;
  private readonly mipresQueue: Queue<MipresRecheckJob>;
  private readonly bulkQueue: Queue<BulkUpdateJob>;
  private readonly tariffQueue: Queue<TariffImportJob | TariffAnnexRevalidationJob>;
  private readonly foundationDeadLetterQueue: Queue<DeadLetterJob>;
  private readonly importDeadLetterQueue: Queue<DeadLetterJob>;
  private readonly mipresDeadLetterQueue: Queue<DeadLetterJob>;
  private readonly bulkDeadLetterQueue: Queue<DeadLetterJob>;
  private readonly tariffDeadLetterQueue: Queue<DeadLetterJob>;
  private readonly foundationQueueEvents: QueueEvents;
  private readonly importQueueEvents: QueueEvents;
  private readonly mipresQueueEvents: QueueEvents;
  private readonly bulkQueueEvents: QueueEvents;
  private readonly tariffQueueEvents: QueueEvents;
  private readonly foundationWorker: Worker<FoundationJob>;
  private readonly importWorker: Worker<AuthorizationImportJob>;
  private readonly mipresWorker: Worker<MipresRecheckJob>;
  private readonly bulkWorker: Worker<BulkUpdateJob>;
  private readonly tariffWorker: Worker<TariffImportJob | TariffAnnexRevalidationJob>;
  private readonly importProcessor: ImportProcessor;
  private readonly mipresProcessor: MipresProcessor;
  private readonly bulkProcessor: BulkUpdateProcessor;
  private readonly tariffImportProcessor: TariffImportProcessor;
  private readonly tariffRevalidationProcessor: TariffRevalidationProcessor;
  private timer?: NodeJS.Timeout;
  private autoRevalidationTimer?: NodeJS.Timeout;
  private expirationSweepTimer?: NodeJS.Timeout;
  private lastExpirationSweepDate: string | null = null;
  private expirationSweeping = false;
  private dispatching = false;
  private lastIdempotencyCleanupAt = 0;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(DATABASE) private readonly database: Database,
  ) {
    this.logger = pino({
      level: config.LOG_LEVEL,
      base: { service: 'authorization-worker' },
      redact: ['token', 'authorization'],
    });
    this.connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.foundationQueue = new Queue<FoundationJob>(FOUNDATION_QUEUE, {
      connection: this.connection,
    });
    this.importQueue = new Queue<AuthorizationImportJob>(IMPORT_QUEUE, {
      connection: this.connection,
    });
    this.mipresQueue = new Queue<MipresRecheckJob>(MIPRES_QUEUE, {
      connection: this.connection,
    });
    this.bulkQueue = new Queue<BulkUpdateJob>(BULK_UPDATES_QUEUE, {
      connection: this.connection,
    });
    this.tariffQueue = new Queue<TariffImportJob | TariffAnnexRevalidationJob>(
      TARIFF_ANNEX_QUEUE,
      {
        connection: this.connection,
      },
    );
    this.foundationDeadLetterQueue = new Queue<DeadLetterJob>(FOUNDATION_DEAD_LETTER_QUEUE, {
      connection: this.connection,
    });
    this.importDeadLetterQueue = new Queue<DeadLetterJob>(IMPORT_DEAD_LETTER_QUEUE, {
      connection: this.connection,
    });
    this.mipresDeadLetterQueue = new Queue<DeadLetterJob>(MIPRES_DEAD_LETTER_QUEUE, {
      connection: this.connection,
    });
    this.bulkDeadLetterQueue = new Queue<DeadLetterJob>(BULK_UPDATES_DEAD_LETTER_QUEUE, {
      connection: this.connection,
    });
    this.tariffDeadLetterQueue = new Queue<DeadLetterJob>(TARIFF_ANNEX_DEAD_LETTER_QUEUE, {
      connection: this.connection,
    });
    this.foundationQueueEvents = new QueueEvents(FOUNDATION_QUEUE, { connection: this.connection });
    this.importQueueEvents = new QueueEvents(IMPORT_QUEUE, { connection: this.connection });
    this.mipresQueueEvents = new QueueEvents(MIPRES_QUEUE, { connection: this.connection });
    this.bulkQueueEvents = new QueueEvents(BULK_UPDATES_QUEUE, { connection: this.connection });
    this.tariffQueueEvents = new QueueEvents(TARIFF_ANNEX_QUEUE, { connection: this.connection });
    this.importProcessor = new ImportProcessor(database, config);
    const mipresTokenProvider = new MipresTokenProvider(config);
    const mipresPort: MipresPort =
      config.MIPRES_BASE_URL && config.MIPRES_NIT && config.MIPRES_INITIAL_TOKEN
        ? new MipresHttpAdapter(config, mipresTokenProvider)
        : new MipresNotConfiguredPort();
    this.mipresProcessor = new MipresProcessor(database, mipresPort);
    this.bulkProcessor = new BulkUpdateProcessor(database);
    this.tariffImportProcessor = new TariffImportProcessor(database);
    this.tariffRevalidationProcessor = new TariffRevalidationProcessor(database);
    this.foundationWorker = new Worker<FoundationJob>(
      FOUNDATION_QUEUE,
      (job) => this.processFoundation(job),
      {
        connection: this.connection,
        concurrency: 5,
      },
    );
    this.importWorker = new Worker<AuthorizationImportJob>(
      IMPORT_QUEUE,
      (job) => this.processImport(job),
      {
        connection: this.connection,
        concurrency: config.IMPORT_QUEUE_CONCURRENCY,
      },
    );
    this.mipresWorker = new Worker<MipresRecheckJob>(
      MIPRES_QUEUE,
      (job) => this.processMipres(job),
      {
        connection: this.connection,
        concurrency: config.MIPRES_QUEUE_CONCURRENCY,
      },
    );
    this.bulkWorker = new Worker<BulkUpdateJob>(
      BULK_UPDATES_QUEUE,
      (job) => this.processBulkUpdate(job),
      {
        connection: this.connection,
        concurrency: config.BULK_QUEUE_CONCURRENCY,
      },
    );
    this.tariffWorker = new Worker<TariffImportJob | TariffAnnexRevalidationJob>(
      TARIFF_ANNEX_QUEUE,
      (job) => this.processTariff(job),
      {
        connection: this.connection,
        concurrency: 2,
      },
    );
  }

  onModuleInit(): void {
    this.foundationWorker.on('completed', (job) => {
      this.logger.info(
        { jobId: job.id, correlationId: job.data?.correlationId, queue: FOUNDATION_QUEUE },
        'job completed',
      );
    });
    this.importWorker.on('completed', (job) => {
      this.logger.info(
        { jobId: job.id, correlationId: job.data?.correlationId, queue: IMPORT_QUEUE },
        'job completed',
      );
    });
    this.mipresWorker.on('completed', (job) => {
      this.logger.info(
        { jobId: job.id, correlationId: job.data?.correlationId, queue: MIPRES_QUEUE },
        'job completed',
      );
    });
    this.bulkWorker.on('completed', (job) => {
      this.logger.info(
        { jobId: job.id, correlationId: job.data?.correlationId, queue: BULK_UPDATES_QUEUE },
        'job completed',
      );
    });
    this.tariffWorker.on('completed', (job) => {
      this.logger.info(
        { jobId: job.id, correlationId: job.data?.correlationId, queue: TARIFF_ANNEX_QUEUE },
        'job completed',
      );
    });
    this.foundationWorker.on('error', (error) => this.handleWorkerError(error));
    this.importWorker.on('error', (error) => this.handleWorkerError(error));
    this.mipresWorker.on('error', (error) => this.handleWorkerError(error));
    this.bulkWorker.on('error', (error) => this.handleWorkerError(error));
    this.tariffWorker.on('error', (error) => this.handleWorkerError(error));
    this.foundationQueueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.moveToDeadLetterWhenExhausted(
        this.foundationQueue,
        this.foundationDeadLetterQueue,
        FOUNDATION_QUEUE,
        jobId,
        failedReason,
      );
    });
    this.importQueueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.moveToDeadLetterWhenExhausted(
        this.importQueue,
        this.importDeadLetterQueue,
        IMPORT_QUEUE,
        jobId,
        failedReason,
      );
    });
    this.mipresQueueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.moveToDeadLetterWhenExhausted(
        this.mipresQueue,
        this.mipresDeadLetterQueue,
        MIPRES_QUEUE,
        jobId,
        failedReason,
      );
    });
    this.bulkQueueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.moveToDeadLetterWhenExhausted(
        this.bulkQueue,
        this.bulkDeadLetterQueue,
        BULK_UPDATES_QUEUE,
        jobId,
        failedReason,
      );
    });
    this.tariffQueueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.moveToDeadLetterWhenExhausted(
        this.tariffQueue,
        this.tariffDeadLetterQueue,
        TARIFF_ANNEX_QUEUE,
        jobId,
        failedReason,
      );
    });
    if (this.config.SCHEDULER_ENABLED) {
      this.timer = setInterval(
        () => void this.dispatchOutbox(),
        this.config.OUTBOX_POLL_INTERVAL_MS,
      );
      void this.dispatchOutbox();
      this.expirationSweepTimer = setInterval(
        () => void this.runExpirationSweep(),
        60_000,
      );
      void this.runExpirationSweep();
    }
  }

  private handleWorkerError(error: Error): void {
    this.logger.error({ error }, 'worker error');
    Sentry.captureException(error);
  }

  private async dispatchOutbox(): Promise<void> {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.cleanupExpiredIdempotencyRecords();
      for (let index = 0; index < 20; index += 1) {
        if (!(await this.dispatchNextEvent())) break;
      }
    } finally {
      this.dispatching = false;
    }
  }

  private async cleanupExpiredIdempotencyRecords(): Promise<void> {
    const now = Date.now();
    if (now - this.lastIdempotencyCleanupAt < 60_000) return;
    this.lastIdempotencyCleanupAt = now;
    try {
      await this.database.pool.query(
        `delete from idempotency_records
         where id in (
           select id from idempotency_records
           where expires_at <= now()
           order by expires_at
           limit 1000
         )`,
      );
    } catch (error) {
      this.lastIdempotencyCleanupAt = 0;
      this.logger.warn({ error }, 'expired idempotency cleanup failed');
    }
  }

  private async dispatchNextEvent(): Promise<boolean> {
    const client = await this.database.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<OutboxRow>(
        `select id, event_type, version, payload, correlation_id, idempotency_key
         from outbox_events
         where (status = 'PENDING' or (status = 'DISPATCHED' and dispatched_at < now() - interval '30 seconds'))
           and available_at <= now()
         order by created_at
         limit 1
         for update skip locked`,
      );
      const event = result.rows[0];
      if (!event) {
        await client.query('commit');
        return false;
      }

      const sharedInput = {
        name: event.event_type,
        version: event.version,
        payload: event.payload,
        correlationId: event.correlation_id,
        idempotencyKey: event.idempotency_key,
      };
      const foundation = foundationJobSchema.safeParse(sharedInput);
      if (foundation.success) {
        await this.enqueueOutboxJob(
          client,
          event,
          FOUNDATION_QUEUE,
          FOUNDATION_JOB_NAME,
          this.foundationQueue,
          foundation.data,
          FOUNDATION_JOB_OPTIONS,
        );
        return true;
      }
      const authorizationImport = authorizationImportJobSchema.safeParse(sharedInput);
      if (authorizationImport.success) {
        await this.enqueueOutboxJob(
          client,
          event,
          IMPORT_QUEUE,
          IMPORT_JOB_NAME,
          this.importQueue,
          authorizationImport.data,
          IMPORT_JOB_OPTIONS,
        );
        return true;
      }
      const mipresRecheck = mipresRecheckJobSchema.safeParse(sharedInput);
      if (mipresRecheck.success) {
        await this.enqueueOutboxJob(
          client,
          event,
          MIPRES_QUEUE,
          MIPRES_JOB_NAME,
          this.mipresQueue,
          mipresRecheck.data,
          MIPRES_JOB_OPTIONS,
        );
        return true;
      }
      const bulkUpdate = bulkUpdateJobSchema.safeParse(sharedInput);
      if (bulkUpdate.success) {
        await this.enqueueOutboxJob(
          client,
          event,
          BULK_UPDATES_QUEUE,
          BULK_UPDATE_JOB_NAME,
          this.bulkQueue,
          bulkUpdate.data,
          BULK_UPDATE_JOB_OPTIONS,
        );
        return true;
      }
      const tariffImport = tariffImportJobSchema.safeParse(sharedInput);
      if (tariffImport.success) {
        await this.enqueueOutboxJob(
          client,
          event,
          TARIFF_ANNEX_QUEUE,
          TARIFF_IMPORT_JOB_NAME,
          this.tariffQueue,
          tariffImport.data,
          TARIFF_JOB_OPTIONS,
        );
        return true;
      }
      const tariffRevalidation = tariffAnnexRevalidationJobSchema.safeParse(sharedInput);
      if (tariffRevalidation.success) {
        await this.enqueueOutboxJob(
          client,
          event,
          TARIFF_ANNEX_QUEUE,
          TARIFF_REVALIDATION_JOB_NAME,
          this.tariffQueue,
          tariffRevalidation.data,
          TARIFF_JOB_OPTIONS,
        );
        return true;
      }

      await client.query(
        `update outbox_events set status = 'FAILED', attempts = attempts + 1, last_error = $2 where id = $1`,
        [event.id, 'Non-retryable outbox contract validation failure'],
      );
      await client.query('commit');
      this.logger.error(
        { eventId: event.id, eventType: event.event_type },
        'non-retryable outbox event rejected',
      );
      return true;
    } catch (error) {
      await client.query('rollback');
      this.logger.error({ error }, 'outbox dispatch failed');
      Sentry.captureException(error);
      return false;
    } finally {
      client.release();
    }
  }

  private async enqueueOutboxJob<T extends QueueJob>(
    client: {
      query: (
        query: string,
        values?: unknown[],
      ) => Promise<{ rows: Array<{ [key: string]: unknown }>; rowCount?: number | null }>;
    },
    event: OutboxRow,
    queueName: string,
    jobName: Parameters<Queue<T>['add']>[0],
    queue: Queue<T>,
    data: T,
    options: Parameters<Queue<T>['add']>[2],
  ): Promise<void> {
    const jobId = createHash('sha256')
      .update(`${queueName}:${event.idempotency_key}`)
      .digest('hex');
    const persistedResult = await client.query(
      'select 1 from job_results where queue = $1 and idempotency_key = $2',
      [queueName, event.idempotency_key],
    );
    if (persistedResult.rowCount) {
      await client.query(
        `update outbox_events set status = 'PROCESSED', processed_at = now(), last_error = null where id = $1`,
        [event.id],
      );
      await client.query('commit');
      return;
    }

    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      await client.query(
        state === 'failed' || state === 'completed'
          ? `update outbox_events set status = 'FAILED', last_error = $2 where id = $1`
          : `update outbox_events set status = 'DISPATCHED', dispatched_at = now() where id = $1`,
        [
          event.id,
          state === 'failed'
            ? existingJob.failedReason
            : state === 'completed'
              ? 'Completed queue job has no persistent result'
              : null,
        ],
      );
      await client.query('commit');
      return;
    }

    await queue.add(jobName, data as Parameters<Queue<T>['add']>[1], { ...options, jobId });
    await client.query(
      `update outbox_events set status = 'DISPATCHED', dispatched_at = now(), attempts = attempts + 1 where id = $1`,
      [event.id],
    );
    await client.query('commit');
  }

  private async processFoundation(rawJob: Job<FoundationJob>): Promise<{ processed: true }> {
    const job = foundationJobSchema.parse(rawJob.data);
    const inserted = await this.database.db
      .insert(jobResults)
      .values({
        queue: FOUNDATION_QUEUE,
        jobName: FOUNDATION_JOB_NAME,
        idempotencyKey: job.idempotencyKey,
        result: { eventId: job.payload.eventId, message: job.payload.message },
        correlationId: job.correlationId,
      })
      .onConflictDoNothing()
      .returning({ id: jobResults.id });

    await this.database.db
      .update(outboxEvents)
      .set({ status: 'PROCESSED', processedAt: new Date(), lastError: null })
      .where(eq(outboxEvents.id, job.payload.eventId));

    this.logger.info(
      {
        jobId: rawJob.id,
        correlationId: job.correlationId,
        duplicate: inserted.length === 0,
        queue: FOUNDATION_QUEUE,
      },
      'foundation event processed',
    );
    return { processed: true };
  }

  private async processImport(rawJob: Job<AuthorizationImportJob>): Promise<{ processed: true }> {
    const job = authorizationImportJobSchema.parse(rawJob.data);
    let result: ImportProcessingResult;
    try {
      result = await this.importProcessor.process(job);
    } catch (error) {
      if (error instanceof NonRetryableImportError) rawJob.discard();
      throw error;
    }
    const inserted = await this.database.db
      .insert(jobResults)
      .values({
        queue: IMPORT_QUEUE,
        jobName: IMPORT_JOB_NAME,
        idempotencyKey: job.idempotencyKey,
        result,
        correlationId: job.correlationId,
      })
      .onConflictDoNothing()
      .returning({ id: jobResults.id });
    await this.database.db
      .update(outboxEvents)
      .set({ status: 'PROCESSED', processedAt: new Date(), lastError: null })
      .where(eq(outboxEvents.id, job.payload.eventId));
    this.logger.info(
      {
        jobId: rawJob.id,
        correlationId: job.correlationId,
        duplicate: inserted.length === 0,
        queue: IMPORT_QUEUE,
        batchId: job.payload.batchId,
      },
      'authorization import processed',
    );
    return { processed: true };
  }

  private async processMipres(rawJob: Job<MipresRecheckJob>): Promise<{ processed: true }> {
    const job = mipresRecheckJobSchema.parse(rawJob.data);
    const result: MipresProcessingResult = await this.mipresProcessor.process(job);
    const inserted = await this.database.db
      .insert(jobResults)
      .values({
        queue: MIPRES_QUEUE,
        jobName: MIPRES_JOB_NAME,
        idempotencyKey: job.idempotencyKey,
        result,
        correlationId: job.correlationId,
      })
      .onConflictDoNothing()
      .returning({ id: jobResults.id });
    await this.database.db
      .update(outboxEvents)
      .set({ status: 'PROCESSED', processedAt: new Date(), lastError: null })
      .where(eq(outboxEvents.id, job.payload.eventId));
    this.logger.info(
      {
        jobId: rawJob.id,
        correlationId: job.correlationId,
        duplicate: inserted.length === 0,
        queue: MIPRES_QUEUE,
        itemId: job.payload.itemId,
        outcome: result.outcome,
        queryType: job.payload.queryType,
      },
      'mipres recheck processed',
    );
    return { processed: true };
  }

  private async processBulkUpdate(rawJob: Job<BulkUpdateJob>): Promise<{ processed: true }> {
    const job = bulkUpdateJobSchema.parse(rawJob.data);
    const result: BulkProcessingResult = await this.bulkProcessor.process(job);
    const inserted = await this.database.db
      .insert(jobResults)
      .values({
        queue: BULK_UPDATES_QUEUE,
        jobName: BULK_UPDATE_JOB_NAME,
        idempotencyKey: job.idempotencyKey,
        result,
        correlationId: job.correlationId,
      })
      .onConflictDoNothing()
      .returning({ id: jobResults.id });
    await this.database.db
      .update(outboxEvents)
      .set({ status: 'PROCESSED', processedAt: new Date(), lastError: null })
      .where(eq(outboxEvents.id, job.payload.eventId));
    this.logger.info(
      {
        jobId: rawJob.id,
        correlationId: job.correlationId,
        queue: BULK_UPDATES_QUEUE,
        batchId: job.payload.batchId,
        duplicate: inserted.length === 0,
        status: result.status,
        updatedRows: result.updatedRows,
      },
      'bulk update processed',
    );
    return { processed: true };
  }

  private async processTariff(
    rawJob: Job<TariffImportJob | TariffAnnexRevalidationJob>,
  ): Promise<{ processed: true }> {
    const data = rawJob.data;
    const importJob = tariffImportJobSchema.safeParse(data);
    if (importJob.success) {
      const result: TariffImportProcessingResult =
        await this.tariffImportProcessor.process(importJob.data);
      await this.database.db
        .insert(jobResults)
        .values({
          queue: TARIFF_ANNEX_QUEUE,
          jobName: TARIFF_IMPORT_JOB_NAME,
          idempotencyKey: importJob.data.idempotencyKey,
          result,
          correlationId: importJob.data.correlationId,
        })
        .onConflictDoNothing();
      await this.database.db
        .update(outboxEvents)
        .set({ status: 'PROCESSED', processedAt: new Date(), lastError: null })
        .where(eq(outboxEvents.id, importJob.data.payload.eventId));
      this.logger.info(
        {
          jobId: rawJob.id,
          correlationId: importJob.data.correlationId,
          queue: TARIFF_ANNEX_QUEUE,
          batchId: importJob.data.payload.batchId,
          status: result.status,
          createdRows: result.createdRows,
        },
        'tariff annex import processed',
      );
      return { processed: true };
    }
    const revalidationJob = tariffAnnexRevalidationJobSchema.safeParse(data);
    if (revalidationJob.success) {
      const result: TariffRevalidationResult =
        await this.tariffRevalidationProcessor.process(revalidationJob.data);
      await this.database.db
        .insert(jobResults)
        .values({
          queue: TARIFF_ANNEX_QUEUE,
          jobName: TARIFF_REVALIDATION_JOB_NAME,
          idempotencyKey: revalidationJob.data.idempotencyKey,
          result,
          correlationId: revalidationJob.data.correlationId,
        })
        .onConflictDoNothing();
      await this.database.db
        .update(outboxEvents)
        .set({ status: 'PROCESSED', processedAt: new Date(), lastError: null })
        .where(eq(outboxEvents.id, revalidationJob.data.payload.eventId));
      this.logger.info(
        {
          jobId: rawJob.id,
          correlationId: revalidationJob.data.correlationId,
          queue: TARIFF_ANNEX_QUEUE,
          codigoProducto: revalidationJob.data.payload.codigoProducto,
          evaluatedItems: result.evaluatedItems,
          becameReadyItems: result.becameReadyItems,
        },
        'tariff annex revalidation processed',
      );
      return { processed: true };
    }
    throw new Error('Unknown tariff annex job payload');
  }

  /**
   * Vencimiento por FECHA_FINAL_VIGENCIA: los registros READY_TO_DISPENSE cuya
   * vigencia ya pasó (comparada contra la fecha del sistema en America/Bogota)
   * pasan a EXPIRED. Se ejecuta una vez por día calendario.
   */
  private async runExpirationSweep(): Promise<void> {
    if (this.expirationSweeping) return;
    this.expirationSweeping = true;
    try {
      const today = currentBogotaDate();
      if (this.lastExpirationSweepDate === today) return;
      const result = await this.database.pool.query<{ id: string }>(
        `update authorization_items
         set operation_status = 'EXPIRED', version = version + 1, updated_at = now()
         where operation_status = 'READY_TO_DISPENSE'
           and (source_data->>'FECHA_FINAL_VIGENCIA') ~ '^[0-9]{8}$'
           and to_date(source_data->>'FECHA_FINAL_VIGENCIA', 'YYYYMMDD') < $1::date
         returning id`,
        [today],
      );
      this.lastExpirationSweepDate = today;
      if (result.rowCount) {
        this.logger.info({ expired: result.rowCount, today }, 'vigencia expiration sweep applied');
      }
    } catch (error) {
      this.logger.error({ error }, 'vigencia expiration sweep failed');
      Sentry.captureException(error);
    } finally {
      this.expirationSweeping = false;
    }
  }

  private async moveToDeadLetterWhenExhausted<T extends QueueJob>(
    queue: Queue<T>,
    deadLetterQueue: Queue<DeadLetterJob>,
    queueName: string,
    jobId: string,
    failedReason: string,
  ): Promise<void> {
    const job = await queue.getJob(jobId);
    if (!job) return;
    const importJob = authorizationImportJobSchema.safeParse(job.data);
    const classification = classifyTerminalImportError(failedReason);
    const isDiscardedImport = importJob.success && classification === 'PROCESSOR_VERSION_MISMATCH';
    if (!isDiscardedImport && job.attemptsMade < (job.opts.attempts ?? 1)) return;
    if (importJob.success) {
      await persistTerminalImportFailure(this.database.pool, {
        batchId: importJob.data.payload.batchId,
        eventId: importJob.data.payload.eventId,
        attemptsMade: job.attemptsMade,
        classification,
      });
    } else {
      await this.database.db
        .update(outboxEvents)
        .set({ status: 'FAILED', lastError: failedReason })
        .where(eq(outboxEvents.id, this.eventIdForJob(job.data)));
    }
    await deadLetterQueue.add(
      'dead-letter.v1',
      {
        sourceQueue: queueName,
        sourceJobId: jobId,
        jobName: job.name,
        payload: job.data,
        failedReason,
        failedAt: new Date().toISOString(),
      },
      { jobId: `dlq-${queueName}-${jobId}`, removeOnComplete: false, removeOnFail: false },
    );
    this.logger.error({ jobId, queue: queueName, failedReason }, 'job moved to dead-letter queue');
  }

  private eventIdForJob(job: WorkerJob): string {
    return job.payload.eventId;
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.autoRevalidationTimer) clearInterval(this.autoRevalidationTimer);
    if (this.expirationSweepTimer) clearInterval(this.expirationSweepTimer);
    await Promise.all([
      this.foundationWorker.close(),
      this.importWorker.close(),
      this.mipresWorker.close(),
      this.bulkWorker.close(),
      this.tariffWorker.close(),
    ]);
    await Promise.all([
      this.foundationQueueEvents.close(),
      this.importQueueEvents.close(),
      this.mipresQueueEvents.close(),
      this.bulkQueueEvents.close(),
      this.tariffQueueEvents.close(),
    ]);
    await Promise.all([
      this.foundationQueue.close(),
      this.importQueue.close(),
      this.mipresQueue.close(),
      this.bulkQueue.close(),
      this.tariffQueue.close(),
      this.foundationDeadLetterQueue.close(),
      this.importDeadLetterQueue.close(),
      this.mipresDeadLetterQueue.close(),
      this.bulkDeadLetterQueue.close(),
      this.tariffDeadLetterQueue.close(),
    ]);
    await this.connection.quit();
    await this.database.pool.end();
  }
}
