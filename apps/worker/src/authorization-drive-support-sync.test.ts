import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { WorkerConfig } from '@authorization/config';
import type { createDatabase } from '@authorization/database';
import { AuthorizationDriveSupportSync } from './authorization-drive-support-sync';

type Database = ReturnType<typeof createDatabase>;
type Candidate = { id: string; authorization_number: string };
type SyncInternals = { findCandidates(): Promise<Candidate[]> };

function candidateQuery(scope: WorkerConfig['GOOGLE_DRIVE_AUDIT_SYNC_SCOPE']) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const sync = new AuthorizationDriveSupportSync(
    {
      GOOGLE_DRIVE_AUDIT_SYNC_SCOPE: scope,
      GOOGLE_DRIVE_AUDIT_SYNC_BATCH_SIZE: 10,
    } as WorkerConfig,
    { pool: { query } } as unknown as Database,
    {} as Logger,
  );

  return {
    query,
    findCandidates: () => (sync as unknown as SyncInternals).findCandidates(),
  };
}

describe('AuthorizationDriveSupportSync candidate scope', () => {
  it('selects authorizations whose last load is within ten days', async () => {
    const { query, findCandidates } = candidateQuery('RECENT_10_DAYS');

    await findCandidates();

    const [statement, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain('join import_batches recent_load');
    expect(statement).toContain('recent_load.id = ai.last_load_id');
    expect(statement).toContain(
      "recent_load.created_at >=\n                  now() - interval '10 days'",
    );
    expect(parameters).toEqual(['RECENT_10_DAYS', 10]);
  });

  it('keeps the default ALL scope free of the recent-load join', async () => {
    const { query, findCandidates } = candidateQuery('ALL');

    await findCandidates();

    const [statement] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).not.toContain('import_batches recent_load');
    expect(query.mock.calls[0]?.[1]).toEqual(['ALL', 10]);
  });

  it('preserves the existing CLOSED_ONLY quantity filter', async () => {
    const { query, findCandidates } = candidateQuery('CLOSED_ONLY');

    await findCandidates();

    const [statement] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain("$1::text =\n                  'CLOSED_ONLY'");
    expect(statement).toContain('greatest(');
    expect(statement).not.toContain('import_batches recent_load');
    expect(query.mock.calls[0]?.[1]).toEqual(['CLOSED_ONLY', 10]);
  });
});
