import { randomUUID } from 'node:crypto';
import type { createDatabase } from '@authorization/database';

const CHECKPOINT_KEY = 'patients.lookup.basic';
const PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 20;
const MAX_RETRIES = 3;
const LEASE_MS = 10 * 60 * 1000;

export type PatientLocalLookupSyncResult = Readonly<{
  status: 'COMPLETED' | 'BUSY' | 'NOT_DUE' | 'FAILED';
  pagesProcessed: number;
  patientsQueued: number;
  retries: number;
  code?: 'CHECKPOINT_FAILURE' | 'PAGE_LIMIT_EXCEEDED';
}>;

export type PatientLocalLookupCheckpoint = Readonly<{
  runId: string;
  leaseToken: string;
  cycleStartedAt: string;
  nextPatientId: string | null;
}>;

export interface PatientLocalLookupSyncRepository {
  claim(input: { now: Date; intervalMs: number; leaseMs: number }): Promise<{
    status: 'CLAIMED' | 'BUSY' | 'NOT_DUE';
    checkpoint?: PatientLocalLookupCheckpoint;
  }>;
  enqueueNextPage(input: {
    checkpoint: PatientLocalLookupCheckpoint;
    now: Date;
    intervalMs: number;
    leaseMs: number;
    pageSize: number;
  }): Promise<{
    completed: boolean;
    recordsSeen: number;
    patientsQueued: number;
    nextPatientId: string | null;
  }>;
  markFailed(input: {
    checkpoint: PatientLocalLookupCheckpoint;
    code: 'CHECKPOINT_FAILURE' | 'PAGE_LIMIT_EXCEEDED';
    retries: number;
  }): Promise<void>;
}

type DatabasePool = ReturnType<typeof createDatabase>['pool'];
type CheckpointRow = {
  status: 'IDLE' | 'RUNNING' | 'FAILED';
  sync_as_of: Date | string;
  pending_as_of: Date | string | null;
  next_cursor: string | null;
  run_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
};

/** Schedules local, authorization-linked identities through the durable lookup outbox. */
export class PgPatientLocalLookupSyncRepository implements PatientLocalLookupSyncRepository {
  constructor(private readonly pool: DatabasePool) {}

  async claim(input: { now: Date; intervalMs: number; leaseMs: number }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into patient_sync_checkpoints (feed_key, profile, sync_as_of)
         values ($1, 'basic', to_timestamp(0))
         on conflict (feed_key) do nothing`,
        [CHECKPOINT_KEY],
      );
      const selected = await client.query<CheckpointRow>(
        `select status, sync_as_of, pending_as_of, next_cursor, run_id, lease_token, lease_expires_at
           from patient_sync_checkpoints where feed_key = $1 for update`,
        [CHECKPOINT_KEY],
      );
      const row = selected.rows[0];
      if (!row) throw new Error('checkpoint missing');
      if (
        row.status === 'RUNNING' &&
        row.lease_expires_at &&
        new Date(row.lease_expires_at).getTime() > input.now.getTime()
      ) {
        await client.query('commit');
        return { status: 'BUSY' as const };
      }
      if (
        row.status === 'IDLE' &&
        input.now.getTime() - new Date(row.sync_as_of).getTime() < input.intervalMs
      ) {
        await client.query('commit');
        return { status: 'NOT_DUE' as const };
      }

      const runId = randomUUID();
      const leaseToken = randomUUID();
      const cycleStartedAt = row.pending_as_of
        ? new Date(row.pending_as_of).toISOString()
        : input.now.toISOString();
      const updated = await client.query(
        `update patient_sync_checkpoints
            set status = 'RUNNING', run_id = $2, lease_token = $3,
                lease_expires_at = $4, pending_as_of = $5,
                run_started_at = coalesce(run_started_at, $6),
                pages_processed = case when status = 'IDLE' then 0 else pages_processed end,
                records_seen = case when status = 'IDLE' then 0 else records_seen end,
                local_patients_matched = case when status = 'IDLE' then 0 else local_patients_matched end,
                retries = case when status = 'IDLE' then 0 else retries end,
                last_error_code = null, updated_at = now()
          where feed_key = $1`,
        [
          CHECKPOINT_KEY,
          runId,
          leaseToken,
          new Date(input.now.getTime() + input.leaseMs),
          cycleStartedAt,
          input.now,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('checkpoint claim failed');
      await client.query('commit');
      return {
        status: 'CLAIMED' as const,
        checkpoint: {
          runId,
          leaseToken,
          cycleStartedAt,
          nextPatientId: row.next_cursor,
        },
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async enqueueNextPage(input: {
    checkpoint: PatientLocalLookupCheckpoint;
    now: Date;
    intervalMs: number;
    leaseMs: number;
    pageSize: number;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const selected = await client.query<CheckpointRow>(
        `select status, sync_as_of, pending_as_of, next_cursor, run_id, lease_token, lease_expires_at
           from patient_sync_checkpoints where feed_key = $1 for update`,
        [CHECKPOINT_KEY],
      );
      const row = selected.rows[0];
      if (
        !row ||
        row.status !== 'RUNNING' ||
        row.run_id !== input.checkpoint.runId ||
        row.lease_token !== input.checkpoint.leaseToken ||
        !row.lease_expires_at ||
        new Date(row.lease_expires_at).getTime() <= input.now.getTime()
      )
        throw new Error('checkpoint lease lost');

      const candidates = await client.query<{ id: string }>(
        `select p.id::text as id
           from patients p
          where ($1::uuid is null or p.id > $1::uuid)
            and exists (
              select 1
                from authorization_items ai
                join authorization_item_organizations aio on aio.authorization_item_id = ai.id
                join organizations o on o.id = aio.organization_id and o.code = 'MEDICARTE'
               where ai.patient_id = p.id
            )
            and (p.mtdom_last_checked_at is null or
                 p.mtdom_last_checked_at <= $2::timestamptz - ($3::bigint * interval '1 millisecond'))
            and not exists (
              select 1 from outbox_events e
               where e.event_type = 'patient.lookup'
                 and e.status in ('PENDING', 'DISPATCHED')
                 and e.payload->>'patientId' = p.id::text
            )
          order by p.id
          limit $4`,
        [input.checkpoint.nextPatientId, input.now, input.intervalMs, input.pageSize],
      );
      const ids = candidates.rows.map(({ id }) => id);
      let patientsQueued = 0;
      for (const patientId of ids) {
        const inserted = await client.query(
          `insert into outbox_events (
             event_type, version, payload, correlation_id, idempotency_key
           ) values ('patient.lookup', 1, $1::jsonb, $2, $3)
           on conflict (idempotency_key) do nothing`,
          [
            JSON.stringify({ patientId }),
            randomUUID(),
            `patient.lookup.v1:${patientId}:${input.checkpoint.cycleStartedAt}`,
          ],
        );
        patientsQueued += inserted.rowCount ?? 0;
      }

      const completed = ids.length < input.pageSize;
      const nextPatientId = ids.at(-1) ?? input.checkpoint.nextPatientId;
      const updated = await client.query(
        `update patient_sync_checkpoints
            set status = $2::varchar,
                sync_as_of = case when $2::varchar = 'IDLE' then $3::timestamptz else sync_as_of end,
                pending_as_of = case when $2::varchar = 'IDLE' then null else pending_as_of end,
                next_cursor = case when $2::varchar = 'IDLE' then null else $4::text end,
                run_id = case when $2::varchar = 'IDLE' then null else run_id end,
                lease_token = case when $2::varchar = 'IDLE' then null else lease_token end,
                lease_expires_at = case when $2::varchar = 'IDLE' then null else $5::timestamptz end,
                pages_processed = pages_processed + case when $6::integer > 0 then 1 else 0 end,
                records_seen = records_seen + $6::integer,
                local_patients_matched = local_patients_matched + $6::integer,
                last_success_at = case when $2::varchar = 'IDLE' then now() else last_success_at end,
                run_started_at = case when $2::varchar = 'IDLE' then null else run_started_at end,
                last_error_code = null, updated_at = now()
          where feed_key = $1::varchar and run_id = $7::uuid and lease_token = $8::uuid
            and lease_expires_at > $3::timestamptz`,
        [
          CHECKPOINT_KEY,
          completed ? 'IDLE' : 'RUNNING',
          input.now,
          nextPatientId,
          new Date(input.now.getTime() + input.leaseMs),
          ids.length,
          input.checkpoint.runId,
          input.checkpoint.leaseToken,
        ],
      );
      if (updated.rowCount !== 1) throw new Error('checkpoint persistence failed');
      await client.query('commit');
      return { completed, recordsSeen: ids.length, patientsQueued, nextPatientId };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(input: {
    checkpoint: PatientLocalLookupCheckpoint;
    code: 'CHECKPOINT_FAILURE' | 'PAGE_LIMIT_EXCEEDED';
    retries: number;
  }): Promise<void> {
    await this.pool.query(
      `update patient_sync_checkpoints
          set status = 'FAILED', lease_token = null, lease_expires_at = null,
              last_error_code = $3, retries = greatest(retries, $4), updated_at = now()
        where feed_key = $1 and run_id = $2 and lease_token = $5 and status = 'RUNNING'`,
      [
        CHECKPOINT_KEY,
        input.checkpoint.runId,
        input.code,
        input.retries,
        input.checkpoint.leaseToken,
      ],
    );
  }
}

export class PatientLocalLookupSyncService {
  private running = false;

  constructor(
    private readonly repository: PatientLocalLookupSyncRepository,
    private readonly options: Readonly<{
      intervalMs: number;
      sleep?: (ms: number) => Promise<void>;
    }>,
  ) {}

  async run(): Promise<PatientLocalLookupSyncResult> {
    if (this.running) return emptyResult('BUSY');
    this.running = true;
    let checkpoint: PatientLocalLookupCheckpoint | undefined;
    let pagesProcessed = 0;
    let patientsQueued = 0;
    let retries = 0;
    try {
      const claim = await this.repository.claim({
        now: new Date(),
        intervalMs: this.options.intervalMs,
        leaseMs: LEASE_MS,
      });
      if (claim.status === 'BUSY' || claim.status === 'NOT_DUE') return emptyResult(claim.status);
      if (!claim.checkpoint) throw new Error('checkpoint claim failed');
      checkpoint = claim.checkpoint;
      for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
        let result:
          | Awaited<ReturnType<PatientLocalLookupSyncRepository['enqueueNextPage']>>
          | undefined;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
          try {
            result = await this.repository.enqueueNextPage({
              checkpoint,
              now: new Date(),
              intervalMs: this.options.intervalMs,
              leaseMs: LEASE_MS,
              pageSize: PAGE_SIZE,
            });
            break;
          } catch {
            if (attempt >= MAX_RETRIES) throw new Error('page failure');
            retries += 1;
            await (this.options.sleep ?? sleep)(Math.min(5_000, 250 * 2 ** attempt));
          }
        }
        if (!result) throw new Error('page failure');
        pagesProcessed += result.recordsSeen > 0 ? 1 : 0;
        patientsQueued += result.patientsQueued;
        if (result.completed)
          return { status: 'COMPLETED', pagesProcessed, patientsQueued, retries };
        checkpoint = { ...checkpoint, nextPatientId: result.nextPatientId };
      }
      await this.repository.markFailed({ checkpoint, code: 'PAGE_LIMIT_EXCEEDED', retries });
      return {
        status: 'FAILED',
        code: 'PAGE_LIMIT_EXCEEDED',
        pagesProcessed,
        patientsQueued,
        retries,
      };
    } catch {
      if (checkpoint) {
        try {
          await this.repository.markFailed({ checkpoint, code: 'CHECKPOINT_FAILURE', retries });
        } catch {
          // Report a bounded code only; database errors may contain sensitive values.
        }
      }
      return {
        status: 'FAILED',
        code: 'CHECKPOINT_FAILURE',
        pagesProcessed,
        patientsQueued,
        retries,
      };
    } finally {
      this.running = false;
    }
  }
}

export class PatientLocalLookupSyncScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly sync: Pick<PatientLocalLookupSyncService, 'run'>,
    private readonly report: (result: PatientLocalLookupSyncResult) => void,
  ) {}

  start(intervalMs: number): void {
    if (!this.timer) this.timer = setInterval(() => void this.trigger(), intervalMs);
  }

  async trigger(): Promise<PatientLocalLookupSyncResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await this.sync.run();
      this.report(result);
      return result;
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function emptyResult(status: 'BUSY' | 'NOT_DUE'): PatientLocalLookupSyncResult;
function emptyResult(status: 'COMPLETED' | 'FAILED'): PatientLocalLookupSyncResult;
function emptyResult(status: PatientLocalLookupSyncResult['status']): PatientLocalLookupSyncResult {
  return { status, pagesProcessed: 0, patientsQueued: 0, retries: 0 };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
