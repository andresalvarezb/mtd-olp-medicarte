import type { createDatabase } from '@authorization/database';
import type { ImportTerminalErrorClassification } from './import-errors';

type DatabasePool = ReturnType<typeof createDatabase>['pool'];

export async function persistTerminalImportFailure(
  pool: DatabasePool,
  input: {
    batchId: string;
    eventId: string;
    attemptsMade: number;
    classification: ImportTerminalErrorClassification;
  },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const lockedBatch = await client.query<{ status: string }>(
      'select status from import_batches where id = $1 for update',
      [input.batchId],
    );
    const status = lockedBatch.rows[0]?.status;
    if (status === 'UPLOADED' || status === 'VALIDATING') {
      await client.query(
        `update import_batches
         set status = 'FAILED', completed_at = now(), last_error_code = $2
         where id = $1 and status in ('UPLOADED', 'VALIDATING')`,
        [input.batchId, input.classification],
      );
    }
    if (status === 'UPLOADED' || status === 'VALIDATING' || status === 'FAILED') {
      await client.query(
        `update import_source_files
         set content = null, processed_at = now()
         where import_batch_id = $1`,
        [input.batchId],
      );
    }
    await client.query(
      `update outbox_events
       set status = 'FAILED', attempts = $2, last_error = $3
       where id = $1 and status <> 'PROCESSED'`,
      [input.eventId, input.attemptsMade, input.classification],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
