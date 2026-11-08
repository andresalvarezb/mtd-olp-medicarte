import { describe, expect, it } from 'vitest';
import {
  PatientLocalLookupSyncService,
  PgPatientLocalLookupSyncRepository,
  type PatientLocalLookupCheckpoint,
  type PatientLocalLookupSyncRepository,
} from './patient-local-lookup-sync';

/* eslint-disable @typescript-eslint/require-await */

const ID_1 = '00000000-0000-4000-8000-000000000001';
const ID_2 = '00000000-0000-4000-8000-000000000002';
const CHECKPOINT: PatientLocalLookupCheckpoint = {
  runId: '00000000-0000-4000-8000-000000000010',
  leaseToken: '00000000-0000-4000-8000-000000000011',
  cycleStartedAt: '2026-11-08T12:00:00.000Z',
  nextPatientId: null,
};

class SyntheticRepository implements PatientLocalLookupSyncRepository {
  pages = 0;
  successfulPages = 0;
  retriesBeforeSuccess = 0;
  failedCode: string | null = null;
  claimBarrier?: Promise<void>;

  async claim() {
    if (this.claimBarrier) await this.claimBarrier;
    return { status: 'CLAIMED' as const, checkpoint: CHECKPOINT };
  }

  async enqueueNextPage() {
    this.pages += 1;
    if (this.retriesBeforeSuccess > 0) {
      this.retriesBeforeSuccess -= 1;
      throw new Error('synthetic database failure');
    }
    this.successfulPages += 1;
    return this.successfulPages === 1
      ? { completed: false, recordsSeen: 2, patientsQueued: 2, nextPatientId: ID_2 }
      : { completed: true, recordsSeen: 0, patientsQueued: 0, nextPatientId: ID_2 };
  }

  async markFailed(input: { code: 'CHECKPOINT_FAILURE' | 'PAGE_LIMIT_EXCEEDED' }) {
    this.failedCode = input.code;
  }
}

describe('periodic local patient lookup sync', () => {
  it('resumes by local patient id, queues bounded pages, and reports metrics without identity data', async () => {
    const repository = new SyntheticRepository();
    const service = new PatientLocalLookupSyncService(repository, {
      intervalMs: 60 * 60 * 1000,
      sleep: async () => undefined,
    });

    const result = await service.run();

    expect(result).toEqual({
      status: 'COMPLETED',
      pagesProcessed: 1,
      patientsQueued: 2,
      retries: 0,
    });
    expect(repository.pages).toBe(2);
    expect(repository.failedCode).toBeNull();
  });

  it('retries a failed page idempotently before advancing its checkpoint', async () => {
    const repository = new SyntheticRepository();
    repository.retriesBeforeSuccess = 1;
    const service = new PatientLocalLookupSyncService(repository, {
      intervalMs: 60 * 60 * 1000,
      sleep: async () => undefined,
    });

    const result = await service.run();

    expect(result).toMatchObject({ status: 'COMPLETED', patientsQueued: 2, retries: 1 });
    expect(repository.pages).toBe(3);
  });

  it('prevents overlapping scheduler runs in one worker process', async () => {
    const repository = new SyntheticRepository();
    let releaseClaim!: () => void;
    repository.claimBarrier = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const service = new PatientLocalLookupSyncService(repository, {
      intervalMs: 60 * 60 * 1000,
      sleep: async () => undefined,
    });

    const firstRun = service.run();
    expect(await service.run()).toMatchObject({ status: 'BUSY' });
    releaseClaim();
    await firstRun;
  });

  it('selects only patients linked to authorizations and writes identity-only outbox payloads', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = [];
    let row: Record<string, unknown> = {
      status: 'IDLE',
      sync_as_of: new Date(0),
      pending_as_of: null,
      next_cursor: null,
      run_id: null,
      lease_token: null,
      lease_expires_at: null,
    };
    const client = {
      async query(sql: string, params: unknown[] = []) {
        captured.push({ sql, params });
        if (sql.includes('select status, sync_as_of')) return { rows: [{ ...row }], rowCount: 1 };
        if (sql.includes('select p.id::text as id'))
          return { rows: [{ id: ID_1 }, { id: ID_2 }], rowCount: 2 };
        if (sql.includes("set status = 'RUNNING'")) {
          row = {
            ...row,
            status: 'RUNNING',
            run_id: params[1],
            lease_token: params[2],
            lease_expires_at: params[3],
            pending_as_of: params[4],
          };
        }
        if (sql.includes('pages_processed = pages_processed +')) {
          row = {
            ...row,
            status: params[1],
            run_id: null,
            lease_token: null,
            lease_expires_at: null,
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
    const repository = new PgPatientLocalLookupSyncRepository({
      connect: async () => client,
      query: (sql: string, params?: unknown[]) => client.query(sql, params ?? []),
    } as never);
    const now = new Date('2026-11-08T12:00:00.000Z');
    const claim = await repository.claim({ now, intervalMs: 60 * 60 * 1000, leaseMs: 60_000 });
    expect(claim.status).toBe('CLAIMED');
    const outcome = await repository.enqueueNextPage({
      checkpoint: claim.checkpoint!,
      now,
      intervalMs: 60 * 60 * 1000,
      leaseMs: 60_000,
      pageSize: 50,
    });

    const selection =
      captured.find(({ sql }) => sql.includes('select p.id::text as id'))?.sql ?? '';
    expect(selection).toContain('join authorization_item_organizations aio');
    expect(selection).toContain("o.code = 'MEDICARTE'");
    expect(selection).toContain("e.status in ('PENDING', 'DISPATCHED')");
    expect(outcome).toMatchObject({ completed: true, recordsSeen: 2, patientsQueued: 2 });
    const events = captured.filter(({ sql }) => sql.includes("values ('patient.lookup', 1"));
    expect(events).toHaveLength(2);
    const payloads = events.map(
      ({ params }) => JSON.parse(String(params[0])) as { patientId: string },
    );
    expect(payloads).toEqual([{ patientId: ID_1 }, { patientId: ID_2 }]);
    expect(events.every(({ params }) => String(params[2]).startsWith('patient.lookup.v1:'))).toBe(
      true,
    );
  });
});
