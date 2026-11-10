import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { WorkerConfig } from '@authorization/config';
import type { createDatabase } from '@authorization/database';
import { AuthorizationDriveSupportSync } from './authorization-drive-support-sync';

type Database = ReturnType<typeof createDatabase>;
type Candidate = { id: string; authorization_number: string };
type SyncInternals = { findCandidates(): Promise<Candidate[]> };
type RunInternals = {
  findCandidates(): Promise<Candidate[]>;
  findEvidence(
    authorizationNumber: string,
    rootIds: readonly string[],
    drive: unknown,
  ): Promise<unknown[]>;
  persistSuccess(id: string, files: readonly unknown[]): Promise<void>;
};

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

  it('logs batch and advisory-lock durations after releasing the lock', async () => {
    const lockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query: lockQuery, release });
    const info = vi.fn();
    const sync = new AuthorizationDriveSupportSync(
      {
        GOOGLE_DRIVE_AUDIT_SYNC_ENABLED: true,
        GOOGLE_DRIVE_AUDIT_ROOT_FOLDER_ID: 'root-folder',
        GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE: `${process.cwd()}/package.json`,
        GOOGLE_DRIVE_AUDIT_SYNC_SCOPE: 'RECENT_10_DAYS',
        GOOGLE_DRIVE_AUDIT_SYNC_BATCH_SIZE: 10,
        GOOGLE_DRIVE_AUDIT_SYNC_CONCURRENCY: 1,
      } as WorkerConfig,
      { pool: { connect } } as unknown as Database,
      { info } as unknown as Logger,
    );
    const internals = sync as unknown as RunInternals;
    vi.spyOn(internals, 'findCandidates').mockResolvedValue([
      { id: 'authorization-id', authorization_number: 'AUTH-1' },
    ]);
    vi.spyOn(internals, 'findEvidence').mockResolvedValue([]);
    vi.spyOn(internals, 'persistSuccess').mockResolvedValue(undefined);

    await sync.run();

    const [payload, message] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload).toMatchObject({
      selected: 1,
      processed: 1,
      failures: 0,
      evidenceFound: 0,
      scope: 'RECENT_10_DAYS',
      status: 'completed',
    });
    expect(message).toBe('authorization drive support sync batch completed');
    expect(typeof payload.poolConnectionAcquireMs).toBe('number');
    expect(typeof payload.candidateSelectionMs).toBe('number');
    expect(typeof payload.durationMs).toBe('number');
    expect(typeof payload.lockHeldMs).toBe('number');
    expect(lockQuery).toHaveBeenCalledTimes(2);
    expect(lockQuery.mock.invocationCallOrder[1] ?? 0).toBeLessThan(
      info.mock.invocationCallOrder[0] ?? -1,
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
