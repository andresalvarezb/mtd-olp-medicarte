import { createHash, randomUUID } from 'node:crypto';
import type { createDatabase } from '@authorization/database';
import { compensarSourceDocumentTypeCodes } from '@authorization/domain';

const CHECKPOINT_KEY_PREFIX = 'patients.lookup.basic.pilot.';
const ALTO_COSTO_CHECKPOINT_KEY = 'patients.lookup.basic.alto-costo';
const PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 20;
const MAX_RETRIES = 3;
const LEASE_MS = 10 * 60 * 1000;

export type PatientLocalLookupSyncResult = Readonly<{
  status: 'COMPLETED' | 'IN_PROGRESS' | 'BUSY' | 'NOT_DUE' | 'FAILED';
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
  last_success_at: Date | string | null;
  pending_as_of: Date | string | null;
  next_cursor: string | null;
  run_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
};

/** Schedules only Alto Costo-linked identities through the targeted lookup outbox. */
export class PgPatientLocalLookupSyncRepository implements PatientLocalLookupSyncRepository {
  private readonly patientIds: readonly string[];
  private readonly checkpointKey: string;

  constructor(private readonly pool: DatabasePool, patientIds: readonly string[] = []) {
    this.patientIds = [...patientIds];
    if (patientIds.length > 0) {
      const cohortHash = createHash('sha256')
        .update([...patientIds].sort().join('\n'))
        .digest('hex')
        .slice(0, 16);
      this.checkpointKey = `${CHECKPOINT_KEY_PREFIX}${cohortHash}`;
    } else {
      this.checkpointKey = ALTO_COSTO_CHECKPOINT_KEY;
    }
  }

  async claim(input: { now: Date; intervalMs: number; leaseMs: number }) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into patient_sync_checkpoints (feed_key, profile, sync_as_of)
         values ($1, 'basic', to_timestamp(0))
         on conflict (feed_key) do nothing`,
        [this.checkpointKey],
      );
      const selected = await client.query<CheckpointRow>(
        `select status, sync_as_of, pending_as_of, next_cursor, run_id, lease_token,
                lease_expires_at, last_success_at
           from patient_sync_checkpoints where feed_key = $1 for update`,
        [this.checkpointKey],
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
        row.last_success_at &&
        bogotaDate(new Date(row.last_success_at)) === bogotaDate(input.now)
      ) {
        await client.query('commit');
        return { status: 'NOT_DUE' as const };
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
          this.checkpointKey,
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
        `select status, sync_as_of, pending_as_of, next_cursor, run_id, lease_token,
                lease_expires_at, last_success_at
           from patient_sync_checkpoints where feed_key = $1 for update`,
        [this.checkpointKey],
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

      const patientIdFilter = this.patientIds.length > 0 ? 'AND p.id = any($6::uuid[])' : '';
      const candidates = await client.query<{ id: string }>(
        `select p.id::text as id
           from patients p
          where ($1::uuid is null or p.id > $1::uuid)
            and p.source_organization_id = (select id from organizations where code = 'COMPENSAR')
            and p.identification_type_raw = any($5::text[])
            and exists (
              select 1
                from authorization_items ai
                join authorization_item_organizations aio on aio.authorization_item_id = ai.id
                join organizations o on o.id = aio.organization_id and o.code = 'MEDICARTE'
               where ai.patient_id = p.id
                 and ai.source_data->>'TIPO_IDENTIFICACION' = p.identification_type_raw
                 and coalesce(nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', ''),
                              nullif(ai.source_data->>'NUM_DOCUMENTO', '')) = p.identification_value_raw
                 and (nullif(ai.source_data->>'IDENTIFICACION_PACIENTE', '') is null
                      or nullif(ai.source_data->>'NUM_DOCUMENTO', '') is null
                      or ai.source_data->>'IDENTIFICACION_PACIENTE' = ai.source_data->>'NUM_DOCUMENTO')
            )
            ${patientIdFilter}
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
        [
          input.checkpoint.nextPatientId,
          input.now,
          input.intervalMs,
          input.pageSize,
          compensarSourceDocumentTypeCodes(),
          ...(this.patientIds.length > 0 ? [this.patientIds] : []),
        ],
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
          this.checkpointKey,
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
        this.checkpointKey,
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
      pageSize?: number;
      maxPagesPerRun?: number;
      yieldAfterPageLimit?: boolean;
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
      const pageSize = this.options.pageSize ?? PAGE_SIZE;
      const maxPagesPerRun = this.options.maxPagesPerRun ?? MAX_PAGES_PER_RUN;
      for (let page = 0; page < maxPagesPerRun; page += 1) {
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
              pageSize,
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
      if (this.options.yieldAfterPageLimit) {
        return { status: 'IN_PROGRESS', pagesProcessed, patientsQueued, retries };
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
  private intervalTimer = false;
  private running = false;
  private stopped = true;

  constructor(
    private readonly sync: Pick<PatientLocalLookupSyncService, 'run'>,
    private readonly report: (result: PatientLocalLookupSyncResult) => void,
  ) {}

  start(intervalMs: number, onError: (error: unknown) => void): void {
    if (!this.timer) {
      this.stopped = false;
      this.timer = setInterval(() => {
        void this.trigger().catch(onError);
      }, intervalMs);
      this.intervalTimer = true;
    }
  }

  startDailyAt(
    hour: number,
    minute: number,
    timeZone: string,
    onError: (error: unknown) => void,
  ): void {
    if (this.timer) return;
    this.stopped = false;
    const scheduleNext = () => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (this.stopped) return;
        void this.trigger().catch(onError).finally(scheduleNext);
      }, nextDailyRunDelay(new Date(), hour, minute, timeZone));
    };
    scheduleNext();

    const current = zonedParts(new Date(), timeZone);
    if (current.hour > hour || (current.hour === hour && current.minute >= minute)) {
      void this.trigger().catch(onError);
    }
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
    this.stopped = true;
    if (this.timer) {
      if (this.intervalTimer) clearInterval(this.timer);
      else clearTimeout(this.timer);
    }
    this.timer = undefined;
    this.intervalTimer = false;
  }
}

type ZonedParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function localDateTimeAsUtc(
  parts: Pick<ZonedParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function zonedDateTimeToUtc(
  parts: Pick<ZonedParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
  timeZone: string,
) {
  const targetAsUtc = localDateTimeAsUtc(parts);
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = zonedParts(new Date(candidate), timeZone);
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    const adjusted = targetAsUtc - (localAsUtc - candidate);
    if (adjusted === candidate) return candidate;
    candidate = adjusted;
  }
  return candidate;
}

function nextDailyRunDelay(
  now: Date,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const current = zonedParts(now, timeZone);
  let target = { ...current, hour, minute };
  let timestamp = zonedDateTimeToUtc(target, timeZone);
  if (timestamp <= now.getTime()) {
    const tomorrow = new Date(Date.UTC(current.year, current.month - 1, current.day + 1));
    target = {
      ...current,
      year: tomorrow.getUTCFullYear(),
      month: tomorrow.getUTCMonth() + 1,
      day: tomorrow.getUTCDate(),
      hour,
      minute,
    };
    timestamp = zonedDateTimeToUtc(target, timeZone);
  }
  return Math.max(0, timestamp - now.getTime());
}

function bogotaDate(date: Date): string {
  const { year, month, day } = zonedParts(date, 'America/Bogota');
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function emptyResult(status: 'BUSY' | 'NOT_DUE'): PatientLocalLookupSyncResult;
function emptyResult(status: 'COMPLETED' | 'FAILED'): PatientLocalLookupSyncResult;
function emptyResult(status: PatientLocalLookupSyncResult['status']): PatientLocalLookupSyncResult {
  return { status, pagesProcessed: 0, patientsQueued: 0, retries: 0 };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
