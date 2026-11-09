import {
  FOUNDATION_QUEUE,
  PATIENT_LOOKUP_JOB_NAME,
  PATIENT_LOOKUP_JOB_OPTIONS,
  patientLookupResultSchema,
  type PatientMasterBasicProfile,
  type PatientLookupJob,
  type PatientLookupResult,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';

type Database = ReturnType<typeof createDatabase>;

export interface PatientLookupProcessor {
  lookupLiveWithResponse?(
    identity: Readonly<{ documentType: string; documentValue: string }>,
  ): Promise<
    | { status: 'FOUND'; basicProfile: PatientMasterBasicProfile }
    | { status: 'NOT_FOUND' | 'AMBIGUOUS' | 'IDENTITY_MISMATCH' | 'UNAVAILABLE' }
  >;
  execute(input: Readonly<{ patientId: string }>): Promise<PatientLookupResult>;
}

export class PatientLookupTerminalError extends Error {
  constructor(
    readonly code = 'PATIENT_LOOKUP_TERMINAL_FAILURE',
    readonly patientStatus: 'AUTH_BLOCKED' | 'FAILED' = 'FAILED',
  ) {
    super(code);
    this.name = 'PatientLookupTerminalError';
  }
}

export class PatientLookupRetryableError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super('PATIENT_LOOKUP_RETRYABLE_FAILURE');
    this.name = 'PatientLookupRetryableError';
  }
}

type ProcessingResult = Readonly<{
  processed: boolean;
  deduplicated?: boolean;
  outcome?: PatientLookupResult['outcome'];
  terminalCode?: string;
}>;

async function markPatientEventFailed(
  database: Database,
  eventId: string,
  patientId: string,
  patientStatus: 'AUTH_BLOCKED' | 'FAILED',
  code: string,
  attemptNumber: number,
) {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const current = await client.query<{ status: string; processing_attempts: number }>(
      `select status, processing_attempts
         from outbox_events
        where id = $1 and event_type = 'patient.lookup' and version = 1
        for update`,
      [eventId],
    );
    if (
      !current.rows[0] ||
      current.rows[0].status === 'PROCESSED' ||
      current.rows[0].status === 'FAILED' ||
      Number(current.rows[0].processing_attempts) !== attemptNumber
    ) {
      await client.query('commit');
      return;
    }
    await client.query(
      `update patients
          set mtdom_lookup_status = $2,
              mtdom_last_checked_at = now(),
              mtdom_last_error_code = $3
        where id = $1::uuid`,
      [patientId, patientStatus, code],
    );
    await client.query(
      `update outbox_events
          set status = 'FAILED', last_error = $2
        where id = $1 and status <> 'PROCESSED'`,
      [eventId, code],
    );
    await client.query('commit');
  } catch {
    await client.query('rollback');
    throw new PatientLookupRetryableError();
  } finally {
    client.release();
  }
}

/** Process a typed patient event and persist only a non-PII lookup outcome. */
export async function processPatientLookupJob(
  database: Database,
  processor: PatientLookupProcessor | undefined,
  job: PatientLookupJob,
): Promise<ProcessingResult> {
  let attemptNumber = 0;
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const event = await client.query<{ status: string; processing_attempts: number }>(
      `select status, processing_attempts
         from outbox_events
        where id = $1 and event_type = 'patient.lookup' and version = 1
        for update`,
      [job.payload.eventId],
    );
    if (!event.rows[0] || event.rows[0].status === 'FAILED') {
      await client.query('commit');
      return { processed: false };
    }

    const prior = await client.query(
      'select 1 from job_results where queue = $1 and idempotency_key = $2',
      [FOUNDATION_QUEUE, job.idempotencyKey],
    );
    if (prior.rowCount) {
      await client.query(
        `update outbox_events
            set status = 'PROCESSED', processed_at = coalesce(processed_at, now()), last_error = null
          where id = $1`,
        [job.payload.eventId],
      );
      await client.query('commit');
      return { processed: true, deduplicated: true };
    }

    if (event.rows[0].status === 'PROCESSED') {
      await client.query('commit');
      return { processed: false };
    }

    if (!processor) {
      await client.query(
        `update patients
            set mtdom_lookup_status = 'FAILED',
                mtdom_last_checked_at = now(),
                mtdom_last_error_code = 'PATIENT_LOOKUP_PROCESSOR_UNAVAILABLE'
          where id = $1::uuid`,
        [job.payload.patientId],
      );
      await client.query(
        `update outbox_events
            set status = 'FAILED', last_error = 'PATIENT_LOOKUP_PROCESSOR_UNAVAILABLE'
          where id = $1`,
        [job.payload.eventId],
      );
      await client.query('commit');
      return { processed: false, terminalCode: 'PATIENT_LOOKUP_PROCESSOR_UNAVAILABLE' };
    }

    const incremented = await client.query<{ processing_attempts: number }>(
      `update outbox_events
          set processing_attempts = processing_attempts + 1
        where id = $1
        returning processing_attempts`,
      [job.payload.eventId],
    );
    attemptNumber = Number(incremented.rows[0]?.processing_attempts ?? 0);
    await client.query('commit');
  } catch {
    await client.query('rollback');
    throw new PatientLookupRetryableError();
  } finally {
    client.release();
  }

  let result: PatientLookupResult;
  try {
    result = patientLookupResultSchema.parse(
      await processor.execute({ patientId: job.payload.patientId }),
    );
  } catch (error) {
    if (error instanceof PatientLookupTerminalError) {
      await markPatientEventFailed(
        database,
        job.payload.eventId,
        job.payload.patientId,
        error.patientStatus,
        error.code,
        attemptNumber,
      );
      return { processed: false, terminalCode: error.code };
    }

    const maxAttempts = PATIENT_LOOKUP_JOB_OPTIONS.attempts;
    const exhausted = attemptNumber >= maxAttempts;
    const exponentialDelay = PATIENT_LOOKUP_JOB_OPTIONS.backoff.delay * 2 ** Math.max(0, attemptNumber - 1);
    const delayMs = Math.min(
      5 * 60 * 1000,
      Math.max(exponentialDelay, error instanceof PatientLookupRetryableError ? error.retryAfterMs ?? 0 : 0),
    );
    const failureCode = exhausted
      ? 'PATIENT_LOOKUP_RETRY_LIMIT_REACHED'
      : 'PATIENT_LOOKUP_RETRYABLE_FAILURE';
    const retry = await database.pool.connect();
    try {
      await retry.query('begin');
      const current = await retry.query<{ status: string; processing_attempts: number }>(
        `select status, processing_attempts
           from outbox_events
          where id = $1 and event_type = 'patient.lookup' and version = 1
          for update`,
        [job.payload.eventId],
      );
      if (
        !current.rows[0] ||
        current.rows[0].status === 'PROCESSED' ||
        current.rows[0].status === 'FAILED' ||
        Number(current.rows[0].processing_attempts) !== attemptNumber
      ) {
        await retry.query('commit');
        return { processed: false, deduplicated: true };
      }
      await retry.query(
        `update outbox_events
            set status = case when $2 then 'FAILED' else status end,
                available_at = case when $2 then available_at else now() + ($3 * interval '1 millisecond') end,
                last_error = $4
          where id = $1 and status <> 'PROCESSED'`,
        [job.payload.eventId, exhausted, delayMs, failureCode],
      );
      if (exhausted) {
        await retry.query(
          `update patients
              set mtdom_lookup_status = 'FAILED',
                  mtdom_last_checked_at = now(),
                  mtdom_last_error_code = $2
            where id = $1::uuid`,
          [job.payload.patientId, failureCode],
        );
      }
      await retry.query('commit');
    } catch {
      await retry.query('rollback');
      throw new PatientLookupRetryableError();
    } finally {
      retry.release();
    }
    throw new PatientLookupRetryableError(delayMs);
  }

  const completed = await database.pool.connect();
  try {
    await completed.query('begin');
    const current = await completed.query<{ status: string; processing_attempts: number }>(
      `select status, processing_attempts
         from outbox_events
        where id = $1 and event_type = 'patient.lookup' and version = 1
        for update`,
      [job.payload.eventId],
    );
    if (
      !current.rows[0] ||
      current.rows[0].status === 'PROCESSED' ||
      current.rows[0].status === 'FAILED' ||
      Number(current.rows[0].processing_attempts) !== attemptNumber
    ) {
      await completed.query('commit');
      return { processed: false, deduplicated: true };
    }
    if (!result.outcome.startsWith('SIMULATED_')) {
      const patientStatus = result.outcome;
      const statusErrorCode = patientStatus === 'NOT_FOUND'
        ? 'PATIENT_NOT_FOUND'
        : patientStatus === 'AMBIGUOUS'
          ? 'AMBIGUOUS_PATIENT_IDENTITY'
          : patientStatus === 'IDENTITY_MISMATCH'
            ? 'PATIENT_IDENTITY_MISMATCH'
            : null;
      await completed.query(
        `update patients
            set mtdom_lookup_status = $2,
                mtdom_last_checked_at = now(),
                mtdom_last_error_code = $3
          where id = $1::uuid`,
        [job.payload.patientId, patientStatus, statusErrorCode],
      );
    }
    await completed.query(
      `insert into job_results (queue, job_name, idempotency_key, result, correlation_id)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (queue, idempotency_key) do nothing`,
      [
        FOUNDATION_QUEUE,
        PATIENT_LOOKUP_JOB_NAME,
        job.idempotencyKey,
        JSON.stringify(result),
        job.correlationId,
      ],
    );
    await completed.query(
      `update outbox_events
          set status = 'PROCESSED', processed_at = now(), last_error = null
        where id = $1 and status <> 'FAILED'`,
      [job.payload.eventId],
    );
    await completed.query('commit');
    return { processed: true, outcome: result.outcome };
  } catch {
    await completed.query('rollback');
    throw new PatientLookupRetryableError();
  } finally {
    completed.release();
  }
}
