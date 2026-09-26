import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { WorkerConfig } from '@authorization/config';
import {
  FOUNDATION_DEAD_LETTER_QUEUE,
  FOUNDATION_JOB_NAME,
  FOUNDATION_JOB_OPTIONS,
  FOUNDATION_QUEUE,
  foundationJobSchema,
  type FoundationJob,
} from '@authorization/contracts';
import { jobResults, outboxEvents } from '@authorization/database';
import type { createDatabase } from '@authorization/database';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import pino from 'pino';
import { DATABASE, WORKER_CONFIG } from './tokens';
import {
  runInventoryExpirationReleaseSweep,
} from './inventory-expiration-release';

type Database = ReturnType<typeof createDatabase>;
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
  payload: FoundationJob;
  failedReason: string;
  failedAt: string;
};


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
  private readonly queue: Queue<FoundationJob>;
  private readonly deadLetterQueue: Queue<DeadLetterJob>;
  private readonly queueEvents: QueueEvents;
  private readonly worker: Worker<FoundationJob>;
  private timer?: NodeJS.Timeout;

  private expirationSweepTimer?:
    NodeJS.Timeout;

  private expirationSweeping =
    false;

  private dispatching = false;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(DATABASE) private readonly database: Database,
  ) {
    this.logger = pino({ level: config.LOG_LEVEL, base: { service: 'platform-worker' } });
    this.connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(FOUNDATION_QUEUE, { connection: this.connection });
    this.deadLetterQueue = new Queue(FOUNDATION_DEAD_LETTER_QUEUE, {
      connection: this.connection,
    });
    this.queueEvents = new QueueEvents(FOUNDATION_QUEUE, { connection: this.connection });
    this.worker = new Worker(FOUNDATION_QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 5,
    });
  }

  onModuleInit(): void {
    this.worker.on('error', (error) => {
      this.logger.error({ error }, 'worker error');
      Sentry.captureException(error);
    });
    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.moveToDeadLetter(jobId, failedReason);
    });
    if (this.config.SCHEDULER_ENABLED) {
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
    } finally {
      this.dispatching = false;
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

      const parsed = foundationJobSchema.safeParse({
        name: event.event_type,
        version: event.version,
        payload: event.payload,
        correlationId: event.correlation_id,
        idempotencyKey: event.idempotency_key,
      });
      if (!parsed.success) {
        await client.query(
          `update outbox_events
           set status = 'FAILED', attempts = attempts + 1,
               last_error = 'Unsupported legacy event; no active processor'
           where id = $1`,
          [event.id],
        );
        await client.query('commit');
        return true;
      }

      const persisted = await client.query(
        'select 1 from job_results where queue = $1 and idempotency_key = $2',
        [FOUNDATION_QUEUE, event.idempotency_key],
      );
      if (persisted.rowCount) {
        await client.query(
          `update outbox_events set status = 'PROCESSED', processed_at = now(), last_error = null where id = $1`,
          [event.id],
        );
        await client.query('commit');
        return true;
      }

      const jobId = createHash('sha256')
        .update(`${FOUNDATION_QUEUE}:${event.idempotency_key}`)
        .digest('hex');
      const existingJob = await this.queue.getJob(jobId);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'failed' || state === 'completed') {
          await client.query(
            `update outbox_events set status = 'FAILED', last_error = $2 where id = $1`,
            [
              event.id,
              state === 'failed'
                ? existingJob.failedReason
                : 'Completed queue job has no persistent result',
            ],
          );
          await client.query('commit');
          return true;
        }
      } else {
        await this.queue.add(FOUNDATION_JOB_NAME, parsed.data, { ...FOUNDATION_JOB_OPTIONS, jobId });
      }
      await client.query(
        `update outbox_events
         set status = 'DISPATCHED', dispatched_at = now(), attempts = attempts + 1
         where id = $1`,
        [event.id],
      );
      await client.query('commit');
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

  private async process(rawJob: Job<FoundationJob>): Promise<{ processed: true }> {
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

  private async moveToDeadLetter(jobId: string, failedReason: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
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

    await this.worker.close();
    await this.queueEvents.close();
    await this.queue.close();
    await this.deadLetterQueue.close();
    await this.connection.quit();
    await this.database.pool.end();
  }
}
