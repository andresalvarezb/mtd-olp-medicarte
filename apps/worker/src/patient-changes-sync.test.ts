/* Synthetic repository/source methods implement Promise-based production contracts. */
/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it, vi } from 'vitest';
import {
  PatientChangesSyncError,
  PatientChangesSyncScheduler,
  PatientChangesSyncService,
  type PatientChangesCheckpoint,
  type PatientChangesPage,
  type PatientChangesPageOutcome,
  type PatientChangesRecord,
  type PatientChangesRequest,
  type PatientChangesSource,
  type PatientChangesSyncErrorCode,
  type PatientChangesSyncRepository,
} from './patient-changes-sync';

const BASE = '2026-01-01T00:00:00.000Z';
const AS_OF = '2026-01-02T00:00:00.000Z';
const ID_A = '00000000-0000-4000-8000-000000000001';
const ID_B = '00000000-0000-4000-8000-000000000002';

type SyntheticPatient = { id: string; type: string; value: string; changesSeenAt: string | null };

class SyntheticRepository implements PatientChangesSyncRepository {
  status: 'IDLE' | 'RUNNING' | 'FAILED' = 'IDLE';
  syncAsOf = BASE;
  pendingAsOf: string | null = null;
  nextCursor: string | null = null;
  cursorFingerprints: readonly string[] = [];
  lastPagePatientIds: string[] = [];
  runId = 'run-1';
  leaseToken = 'lease-1';
  patients: SyntheticPatient[] = [
    { id: ID_A, type: 'CC', value: '000101', changesSeenAt: null },
    { id: ID_B, type: 'CC', value: '000202', changesSeenAt: null },
    {
      id: '00000000-0000-4000-8000-000000000003',
      type: 'CC',
      value: '000303',
      changesSeenAt: '2026-01-03T00:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      type: 'CC',
      value: '000404',
      changesSeenAt: null,
    },
  ];
  persistedPages = 0;
  failPersist = false;
  lastError: PatientChangesSyncErrorCode | null = null;

  async claim(): Promise<PatientChangesCheckpoint | null> {
    if (this.status === 'RUNNING') return null;
    this.status = 'RUNNING';
    this.leaseToken = `lease-${Number(this.leaseToken.split('-')[1]) + 1}`;
    return {
      runId: this.runId,
      leaseToken: this.leaseToken,
      baseAsOf: this.syncAsOf,
      pendingAsOf: this.pendingAsOf,
      nextCursor: this.nextCursor,
      cursorFingerprints: this.cursorFingerprints,
    };
  }

  async persistPage(input: {
    checkpoint: PatientChangesCheckpoint;
    page: PatientChangesPage;
    cursorFingerprints: readonly string[];
    nextCursor: string | null;
    leaseMs: number;
  }): Promise<PatientChangesPageOutcome> {
    if (input.checkpoint.leaseToken !== this.leaseToken || this.status !== 'RUNNING') {
      throw new PatientChangesSyncError('FENCED_RUN');
    }
    if (this.failPersist) throw new Error('synthetic transaction failure');
    const previous = new Set(this.lastPagePatientIds);
    const current = new Set<string>();
    let matched = 0;
    let unrelated = 0;
    let ambiguous = 0;
    let duplicates = 0;
    let stale = 0;
    for (const record of input.page.records) {
      const candidates = this.patients.filter(
        (patient) => patient.type === record.documentType && patient.value === record.documentValue,
      );
      if (!candidates.length) {
        unrelated += 1;
        continue;
      }
      if (candidates.length > 1) {
        ambiguous += 1;
        continue;
      }
      const patient = candidates[0]!;
      if (previous.has(patient.id) || current.has(patient.id)) {
        duplicates += 1;
        continue;
      }
      current.add(patient.id);
      if (
        patient.changesSeenAt &&
        Date.parse(patient.changesSeenAt) === Date.parse(input.page.syncAsOf)
      ) {
        duplicates += 1;
        continue;
      }
      if (
        patient.changesSeenAt &&
        Date.parse(patient.changesSeenAt) > Date.parse(input.page.syncAsOf)
      )
        stale += 1;
      else {
        patient.changesSeenAt = input.page.syncAsOf;
        matched += 1;
      }
    }
    this.persistedPages += 1;
    if (input.nextCursor === null) {
      this.syncAsOf = input.page.syncAsOf;
      this.status = 'IDLE';
      this.pendingAsOf = null;
      this.nextCursor = null;
      this.cursorFingerprints = [];
      this.lastPagePatientIds = [];
    } else {
      this.pendingAsOf = input.page.syncAsOf;
      this.nextCursor = input.nextCursor;
      this.cursorFingerprints = input.cursorFingerprints;
      this.lastPagePatientIds = [...current];
    }
    return {
      recordsSeen: input.page.records.length,
      localPatientsMatched: matched,
      unrelatedRecordsSkipped: unrelated,
      ambiguousLocalRecordsSkipped: ambiguous,
      boundaryDuplicatesSkipped: duplicates,
      staleRecordsSkipped: stale,
    };
  }

  async markFailed(input: { code: PatientChangesSyncErrorCode }): Promise<void> {
    this.status = 'FAILED';
    this.lastError = input.code;
    this.leaseToken = '';
  }
}

function record(value: string): PatientChangesRecord {
  return { documentType: 'CC', documentValue: value };
}

function page(
  records: PatientChangesRecord[],
  hasMore = false,
  nextCursor?: string,
): PatientChangesPage {
  return { syncAsOf: AS_OF, records, hasMore, ...(nextCursor ? { nextCursor } : {}) };
}

function service(
  repository: SyntheticRepository,
  fetchPage: PatientChangesSource['fetchPage'],
  maxRetries = 0,
) {
  return new PatientChangesSyncService(
    repository,
    { fetchPage },
    {
      pageLimit: 100,
      leaseMs: 60_000,
      maxRetries,
      maxPages: 10,
      retryDelayMs: () => 0,
      sleep: async () => undefined,
    },
  );
}

describe('patient changes sync (synthetic adapter only)', () => {
  it('reads since then opaque cursor, filters to one local match, deduplicates inclusive boundary, and advances as_of only on final page', async () => {
    const repository = new SyntheticRepository();
    const requests: PatientChangesRequest[] = [];
    const sync = service(repository, async (request) => {
      requests.push(request);
      if (requests.length === 1)
        return page([record('000101'), record('EXTERNAL')], true, 'opaque-cursor-A');
      return page([record('000101'), record('000202')]);
    });

    const result = await sync.run();

    expect(requests).toEqual([
      { since: BASE, profile: 'basic', limit: 100 },
      { cursor: 'opaque-cursor-A' },
    ]);
    expect(result).toMatchObject({
      status: 'COMPLETED',
      pagesProcessed: 2,
      recordsSeen: 4,
      localPatientsMatched: 2,
      unrelatedRecordsSkipped: 1,
      boundaryDuplicatesSkipped: 1,
    });
    expect(repository.syncAsOf).toBe(AS_OF);
    expect(repository.patients.find((patient) => patient.id === ID_A)?.changesSeenAt).toBe(AS_OF);
    expect(repository.patients.find((patient) => patient.id === ID_B)?.changesSeenAt).toBe(AS_OF);
    expect(repository.patients.find((patient) => patient.value === 'EXTERNAL')).toBeUndefined();
    expect(repository.status).toBe('IDLE');
  });

  it('leaves checkpoint unchanged after a middle-page failure and resumes by cursor after restart', async () => {
    const repository = new SyntheticRepository();
    const firstRequests: PatientChangesRequest[] = [];
    const firstRun = service(repository, async (request) => {
      firstRequests.push(request);
      if (firstRequests.length === 1) return page([record('000101')], true, 'resume-cursor');
      throw new Error('synthetic source error with private payload');
    });
    const failed = await firstRun.run();
    expect(failed).toMatchObject({ status: 'FAILED', code: 'SOURCE_FAILURE', pagesProcessed: 1 });
    expect(repository.syncAsOf).toBe(BASE);
    expect(repository.nextCursor).toBe('resume-cursor');
    expect(repository.lastError).toBe('SOURCE_FAILURE');

    const resumedRequests: PatientChangesRequest[] = [];
    const resumed = service(repository, async (request) => {
      resumedRequests.push(request);
      return page([record('000202')]);
    });
    const result = await resumed.run();
    expect(resumedRequests).toEqual([{ cursor: 'resume-cursor' }]);
    expect(result.status).toBe('COMPLETED');
    expect(repository.syncAsOf).toBe(AS_OF);
    expect(repository.patients.find((patient) => patient.id === ID_A)?.changesSeenAt).toBe(AS_OF);
  });

  it('retries transient source failures without exposing raw error text', async () => {
    const repository = new SyntheticRepository();
    let attempts = 0;
    const result = await service(
      repository,
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('private identifier in source exception');
        return page([record('000101')]);
      },
      1,
    ).run();
    expect(attempts).toBe(2);
    expect(result).toMatchObject({ status: 'COMPLETED', retries: 1 });
    expect(JSON.stringify(result)).not.toContain('private identifier');
  });

  it('uses the completed as_of as the next run baseline and remains idempotent on repeated local records', async () => {
    const repository = new SyntheticRepository();
    const first = await service(repository, async () =>
      page([record('000101'), record('000101')]),
    ).run();
    expect(first).toMatchObject({
      status: 'COMPLETED',
      localPatientsMatched: 1,
      boundaryDuplicatesSkipped: 1,
    });
    const nextRequests: PatientChangesRequest[] = [];
    const second = await service(repository, async (request) => {
      nextRequests.push(request);
      return page([record('000202')]);
    }).run();
    expect(second.status).toBe('COMPLETED');
    expect(nextRequests).toEqual([{ since: AS_OF, profile: 'basic', limit: 100 }]);
  });

  it('rejects repeated cursors and invalid page contracts without advancing as_of', async () => {
    const repository = new SyntheticRepository();
    const result = await service(repository, async () => ({
      syncAsOf: AS_OF,
      records: [],
      hasMore: true,
    })).run();
    expect(result).toMatchObject({ status: 'FAILED', code: 'INVALID_CURSOR' });
    expect(repository.syncAsOf).toBe(BASE);
    expect(repository.persistedPages).toBe(0);

    const loopRepo = new SyntheticRepository();
    const loop = await service(loopRepo, async () => page([], true, 'same')).run();
    expect(loop.status).toBe('FAILED');
    const resumed = service(loopRepo, async () => page([], true, 'same'));
    // A cursor is opaque and only a subsequent response can repeat a prior cursor.
    loopRepo.status = 'FAILED';
    loopRepo.pendingAsOf = AS_OF;
    loopRepo.nextCursor = 'same';
    loopRepo.cursorFingerprints = [
      (await import('node:crypto')).createHash('sha256').update('same').digest('hex'),
    ];
    const repeated = await resumed.run();
    expect(repeated).toMatchObject({ status: 'FAILED', code: 'CURSOR_LOOP' });
  });

  it('skips ambiguous and obsolete identities and never stores unmatched external records', async () => {
    const repository = new SyntheticRepository();
    repository.patients.push({ id: 'duplicate', type: 'CC', value: '000101', changesSeenAt: null });
    repository.patients.find((patient) => patient.value === '000303')!.changesSeenAt =
      '2026-01-03T00:00:00.000Z';
    const result = await service(repository, async () =>
      page([record('000101'), record('000303'), record('external-only')]),
    ).run();
    expect(result).toMatchObject({
      status: 'COMPLETED',
      ambiguousLocalRecordsSkipped: 1,
      staleRecordsSkipped: 1,
      unrelatedRecordsSkipped: 1,
    });
    expect(repository.patients.some((patient) => patient.value === 'external-only')).toBe(false);
    expect(repository.patients.find((patient) => patient.value === '000303')?.changesSeenAt).toBe(
      '2026-01-03T00:00:00.000Z',
    );
  });

  it('rejects overlapping runs and fences an older lease', async () => {
    const repository = new SyntheticRepository();
    let release!: (value: PatientChangesPage) => void;
    const blocked = new Promise<PatientChangesPage>((resolve) => {
      release = resolve;
    });
    const running = service(repository, async () => blocked).run();
    await vi.waitFor(() => expect(repository.status).toBe('RUNNING'));
    const overlap = await service(repository, async () => page([])).run();
    expect(overlap.status).toBe('BUSY');
    release(page([record('000101')]));
    expect((await running).status).toBe('COMPLETED');
    await expect(
      repository.persistPage({
        checkpoint: {
          runId: 'run-1',
          leaseToken: 'expired-token',
          baseAsOf: BASE,
          pendingAsOf: null,
          nextCursor: null,
          cursorFingerprints: [],
        },
        page: page([]),
        cursorFingerprints: [],
        nextCursor: null,
        leaseMs: 60_000,
      }),
    ).rejects.toMatchObject({ code: 'FENCED_RUN' });
  });

  it('runs on a configurable scheduler trigger and reports only aggregate results', async () => {
    const sync = { run: vi.fn().mockResolvedValue({ status: 'COMPLETED', pagesProcessed: 2 }) };
    const report = vi.fn();
    const scheduler = new PatientChangesSyncScheduler(sync as never, report);
    await expect(scheduler.trigger()).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(report).toHaveBeenCalledWith({ status: 'COMPLETED', pagesProcessed: 2 });
  });
});
