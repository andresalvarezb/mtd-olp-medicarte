import { describe, expect, it, vi } from 'vitest';
import type { createDatabase } from '@authorization/database';
import { persistTerminalImportFailure } from './import-terminal-failure';

type Pool = ReturnType<typeof createDatabase>['pool'];

function createPool(status: string): { pool: Pool; queries: string[] } {
  const queries: string[] = [];
  const client = {
    query: vi.fn((query: string) => {
      queries.push(query);
      return Promise.resolve(
        query.includes('select status')
          ? { rows: [{ status }], rowCount: 1 }
          : { rows: [], rowCount: 1 },
      );
    }),
    release: vi.fn(),
  };
  return {
    pool: { connect: vi.fn(() => Promise.resolve(client)) } as unknown as Pool,
    queries,
  };
}

describe('persistTerminalImportFailure', () => {
  it('fails only retryable processing states and clears source PHI in the same transaction', async () => {
    const { pool, queries } = createPool('CARGADO');

    await persistTerminalImportFailure(pool, {
      batchId: 'batch-id',
      eventId: 'event-id',
      attemptsMade: 3,
      classification: 'PROCESSING_ERROR',
    });

    expect(queries[0]).toBe('begin');
    expect(queries[1]).toContain('for update');
    expect(queries[2]).toContain("status in ('CARGADO', 'VALIDANDO')");
    expect(queries[3]).toContain('set content = null, processed_at = now()');
    expect(queries[4]).toContain("status <> 'PROCESADO'");
    expect(queries[5]).toBe('commit');
  });

  it('does not clear content when the guarded batch transition did not occur', async () => {
    const { pool, queries } = createPool('LISTO_PARA_CONFIRMAR');

    await persistTerminalImportFailure(pool, {
      batchId: 'batch-id',
      eventId: 'event-id',
      attemptsMade: 1,
      classification: 'PROCESSOR_VERSION_MISMATCH',
    });

    expect(queries.some((query) => query.includes('update import_source_files'))).toBe(false);
    expect(queries.some((query) => query.includes('update import_batches'))).toBe(false);
    expect(queries.at(-1)).toBe('commit');
  });

  it('idempotently clears PHI for a batch that is already terminally failed', async () => {
    const { pool, queries } = createPool('FALLIDO');

    await persistTerminalImportFailure(pool, {
      batchId: 'batch-id',
      eventId: 'event-id',
      attemptsMade: 3,
      classification: 'PROCESSING_ERROR',
    });

    expect(queries.some((query) => query.includes('update import_batches'))).toBe(false);
    expect(queries.some((query) => query.includes('update import_source_files'))).toBe(true);
  });
});
