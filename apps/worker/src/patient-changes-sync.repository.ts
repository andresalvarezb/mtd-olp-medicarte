import { randomUUID } from 'node:crypto';
import type { createDatabase } from '@authorization/database';
import {
  PATIENT_CHANGES_FEED_KEY,
  PatientChangesSyncError,
  type PatientChangesCheckpoint,
  type PatientChangesPage,
  type PatientChangesPageOutcome,
  type PatientChangesSyncErrorCode,
  type PatientChangesSyncRepository,
} from './patient-changes-sync';

type DatabasePool = ReturnType<typeof createDatabase>['pool'];

type CheckpointRow = {
  status: 'IDLE' | 'RUNNING' | 'FAILED';
  sync_as_of: Date | string;
  pending_as_of: Date | string | null;
  next_cursor: string | null;
  cursor_fingerprints: string[];
  last_page_patient_ids: string[];
  run_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
};

export class PgPatientChangesSyncRepository implements PatientChangesSyncRepository {
  constructor(private readonly pool: DatabasePool) {}

  async claim(input: { now: Date; leaseMs: number }): Promise<PatientChangesCheckpoint | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<CheckpointRow>(
        `select status, sync_as_of, pending_as_of, next_cursor, cursor_fingerprints,
                last_page_patient_ids, run_id, lease_token, lease_expires_at
         from patient_sync_checkpoints where feed_key = $1 for update`,
        [PATIENT_CHANGES_FEED_KEY],
      );
      const row = result.rows[0];
      if (!row) throw new PatientChangesSyncError('INITIAL_CHECKPOINT_MISSING');
      if (
        row.status === 'RUNNING' &&
        row.lease_expires_at &&
        new Date(row.lease_expires_at) > input.now
      ) {
        await client.query('commit');
        return null;
      }
      const runId = row.run_id ?? randomUUID();
      const leaseToken = randomUUID();
      const checkpointUpdate = await client.query(
        `update patient_sync_checkpoints
         set status = 'RUNNING', run_id = $2, lease_token = $3,
             lease_expires_at = $4, run_started_at = coalesce(run_started_at, $5),
             pages_processed = case when status = 'IDLE' then 0 else pages_processed end,
             records_seen = case when status = 'IDLE' then 0 else records_seen end,
             local_patients_matched = case when status = 'IDLE' then 0 else local_patients_matched end,
             unrelated_records_skipped = case when status = 'IDLE' then 0 else unrelated_records_skipped end,
             ambiguous_local_records_skipped = case when status = 'IDLE' then 0 else ambiguous_local_records_skipped end,
             boundary_duplicates_skipped = case when status = 'IDLE' then 0 else boundary_duplicates_skipped end,
             stale_records_skipped = case when status = 'IDLE' then 0 else stale_records_skipped end,
             retries = case when status = 'IDLE' then 0 else retries end,
             updated_at = now(), last_error_code = null
         where feed_key = $1`,
        [
          PATIENT_CHANGES_FEED_KEY,
          runId,
          leaseToken,
          new Date(input.now.getTime() + input.leaseMs),
          input.now,
        ],
      );
      if (checkpointUpdate.rowCount !== 1) throw new PatientChangesSyncError('FENCED_RUN');
      await client.query('commit');
      return {
        runId,
        leaseToken,
        baseAsOf: new Date(row.sync_as_of).toISOString(),
        pendingAsOf: row.pending_as_of ? new Date(row.pending_as_of).toISOString() : null,
        nextCursor: row.next_cursor,
        cursorFingerprints: row.cursor_fingerprints ?? [],
      };
    } catch (error) {
      await client.query('rollback');
      if (error instanceof PatientChangesSyncError) throw error;
      throw new PatientChangesSyncError('SOURCE_FAILURE');
    } finally {
      client.release();
    }
  }

  async persistPage(input: {
    checkpoint: PatientChangesCheckpoint;
    page: PatientChangesPage;
    cursorFingerprints: readonly string[];
    nextCursor: string | null;
    leaseMs: number;
    retries: number;
  }): Promise<PatientChangesPageOutcome> {
    const client = await this.pool.connect();
    const outcome: PatientChangesPageOutcome = {
      recordsSeen: input.page.records.length,
      localPatientsMatched: 0,
      unrelatedRecordsSkipped: 0,
      ambiguousLocalRecordsSkipped: 0,
      boundaryDuplicatesSkipped: 0,
      staleRecordsSkipped: 0,
    };
    try {
      await client.query('begin');
      const checkpoint = await client.query<CheckpointRow>(
        `select status, sync_as_of, pending_as_of, next_cursor, cursor_fingerprints,
                last_page_patient_ids, run_id, lease_token, lease_expires_at
         from patient_sync_checkpoints where feed_key = $1 for update`,
        [PATIENT_CHANGES_FEED_KEY],
      );
      const row = checkpoint.rows[0];
      if (
        !row ||
        row.status !== 'RUNNING' ||
        row.run_id !== input.checkpoint.runId ||
        row.lease_token !== input.checkpoint.leaseToken ||
        !row.lease_expires_at ||
        new Date(row.lease_expires_at).getTime() <= Date.now()
      ) {
        throw new PatientChangesSyncError('FENCED_RUN');
      }
      if (
        row.pending_as_of &&
        new Date(row.pending_as_of).getTime() !== Date.parse(input.page.syncAsOf)
      ) {
        throw new PatientChangesSyncError('AS_OF_MISMATCH');
      }
      const previousPageIds = new Set(row.last_page_patient_ids ?? []);
      const currentPageIds = new Set<string>();
      let matched = 0;
      let unrelated = 0;
      let ambiguous = 0;
      let duplicates = 0;
      let stale = 0;
      for (const record of input.page.records) {
        const candidates = await client.query<{
          id: string;
          mtdom_changes_seen_at: Date | string | null;
        }>(
          `select id, mtdom_changes_seen_at from patients
           where identification_type_raw = $1 and identification_value_raw = $2`,
          [record.documentType, record.documentValue],
        );
        if (candidates.rowCount === 0) {
          unrelated += 1;
          continue;
        }
        if (candidates.rowCount !== 1) {
          ambiguous += 1;
          continue;
        }
        const patient = candidates.rows[0]!;
        if (previousPageIds.has(patient.id) || currentPageIds.has(patient.id)) {
          duplicates += 1;
          continue;
        }
        if (patient.mtdom_changes_seen_at) {
          const previouslySeenAt = new Date(patient.mtdom_changes_seen_at).getTime();
          const pageAsOf = Date.parse(input.page.syncAsOf);
          if (previouslySeenAt === pageAsOf) {
            duplicates += 1;
            continue;
          }
          if (previouslySeenAt > pageAsOf) {
            stale += 1;
            continue;
          }
        }
        currentPageIds.add(patient.id);
        const changed = await client.query(
          `update patients set mtdom_changes_seen_at = $2, updated_at = now()
           where id = $1 and (mtdom_changes_seen_at is null or mtdom_changes_seen_at <= $2)`,
          [patient.id, input.page.syncAsOf],
        );
        if (!changed.rowCount) stale += 1;
        else matched += 1;
      }
      const finalPage = input.nextCursor === null;
      const leaseExpiresAt = new Date(Date.now() + input.leaseMs);
      const persistedCheckpoint = await client.query(
        `update patient_sync_checkpoints
         set status = $2,
             sync_as_of = case when $2 = 'IDLE' then $3 else sync_as_of end,
             pending_as_of = case when $2 = 'IDLE' then null else $3 end,
             next_cursor = case when $2 = 'IDLE' then null else $4 end,
             cursor_fingerprints = case when $2 = 'IDLE' then '[]'::jsonb else $5::jsonb end,
             last_page_patient_ids = case when $2 = 'IDLE' then '[]'::jsonb else $6::jsonb end,
             run_id = case when $2 = 'IDLE' then null else run_id end,
             lease_token = case when $2 = 'IDLE' then null else lease_token end,
             lease_expires_at = case when $2 = 'IDLE' then null else $7 end,
             pages_processed = pages_processed + 1,
             records_seen = records_seen + $8,
             local_patients_matched = local_patients_matched + $9,
             unrelated_records_skipped = unrelated_records_skipped + $10,
             ambiguous_local_records_skipped = ambiguous_local_records_skipped + $11,
             boundary_duplicates_skipped = boundary_duplicates_skipped + $12,
             stale_records_skipped = stale_records_skipped + $13,
             retries = greatest(retries, $14),
             last_error_code = null,
             last_success_at = case when $2 = 'IDLE' then now() else last_success_at end,
             run_started_at = case when $2 = 'IDLE' then null else run_started_at end,
             updated_at = now()
         where feed_key = $1 and run_id = $15 and lease_token = $16
           and lease_expires_at > now()`,
        [
          PATIENT_CHANGES_FEED_KEY,
          finalPage ? 'IDLE' : 'RUNNING',
          input.page.syncAsOf,
          input.nextCursor,
          JSON.stringify(input.cursorFingerprints),
          JSON.stringify([...currentPageIds]),
          leaseExpiresAt,
          outcome.recordsSeen,
          matched,
          unrelated,
          ambiguous,
          duplicates,
          stale,
          input.retries,
          input.checkpoint.runId,
          input.checkpoint.leaseToken,
        ],
      );
      if (persistedCheckpoint.rowCount !== 1) throw new PatientChangesSyncError('FENCED_RUN');
      await client.query('commit');
      return {
        ...outcome,
        localPatientsMatched: matched,
        unrelatedRecordsSkipped: unrelated,
        ambiguousLocalRecordsSkipped: ambiguous,
        boundaryDuplicatesSkipped: duplicates,
        staleRecordsSkipped: stale,
      };
    } catch (error) {
      await client.query('rollback');
      if (error instanceof PatientChangesSyncError) throw error;
      throw new PatientChangesSyncError('SOURCE_FAILURE');
    } finally {
      client.release();
    }
  }

  async markFailed(input: {
    checkpoint: PatientChangesCheckpoint;
    code: PatientChangesSyncErrorCode;
    retries: number;
  }): Promise<void> {
    await this.pool.query(
      `update patient_sync_checkpoints
       set status = 'FAILED', lease_token = null, lease_expires_at = null,
           last_error_code = $3, retries = greatest(retries, $5), updated_at = now()
       where feed_key = $1 and run_id = $2 and lease_token = $4 and status = 'RUNNING'`,
      [
        PATIENT_CHANGES_FEED_KEY,
        input.checkpoint.runId,
        input.code,
        input.checkpoint.leaseToken,
        input.retries,
      ],
    );
  }
}
