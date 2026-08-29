import { createHash } from 'node:crypto';
import type { WorkerConfig } from '@authorization/config';
import type { AuthorizationImportJob } from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { describe, expect, it, vi } from 'vitest';
import { NonRetryableImportError } from './import-errors';
import { ImportProcessor } from './import-processor';

type Database = ReturnType<typeof createDatabase>;

const job: AuthorizationImportJob = {
  name: 'authorization.import',
  version: 1,
  payload: {
    eventId: '11111111-1111-4111-8111-111111111111',
    batchId: '22222222-2222-4222-8222-222222222222',
    sourceFileId: '33333333-3333-4333-8333-333333333333',
    processorVersion: 1,
    correlationId: '44444444-4444-4444-8444-444444444444',
    idempotencyKey: 'import-batch',
  },
  correlationId: '44444444-4444-4444-8444-444444444444',
  idempotencyKey: 'import-batch',
};

const config = { IMPORT_PROCESSOR_VERSION: 1 } as WorkerConfig;

function source(
  processorVersion: number,
  content = Buffer.from(
    'NUMERO_AUTORIZACION,COD_COMERCIAL,CUPS_PRINCIPAL,ESTADO_AUTORIZACION\nA,M,C,ACTIVA',
  ),
) {
  const sha256 = createHash('sha256').update(content).digest('hex');
  return {
    batch_id: job.payload.batchId,
    batch_status: 'UPLOADED',
    batch_sha256: sha256,
    batch_processor_version: processorVersion,
    source_file_id: job.payload.sourceFileId,
    original_filename: 'authorizations.csv',
    mime_type: 'text/csv',
    size_bytes: content.length,
    source_sha256: sha256,
    content,
  };
}

describe('ImportProcessor processor version validation', () => {
  it('rejects a job that differs from the batch version as non-retryable', async () => {
    const connect = vi.fn();
    const database = {
      pool: {
        query: vi.fn(() => Promise.resolve({ rows: [source(2)] })),
        connect,
      },
    } as unknown as Database;

    await expect(new ImportProcessor(database, config).process(job)).rejects.toMatchObject({
      classification: 'PROCESSOR_VERSION_MISMATCH',
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('rechecks the configured and batch versions under the batch row lock', async () => {
    const client = {
      query: vi.fn((query: string) => {
        if (query.includes('for update'))
          return Promise.resolve({
            rows: [{ status: 'UPLOADED', processor_version: 2 }],
            rowCount: 1,
          });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: vi.fn(),
    };
    const database = {
      pool: {
        query: vi.fn(() => Promise.resolve({ rows: [source(1)] })),
        connect: vi.fn(() => Promise.resolve(client)),
      },
    } as unknown as Database;

    await expect(new ImportProcessor(database, config).process(job)).rejects.toBeInstanceOf(
      NonRetryableImportError,
    );
    expect(client.query).toHaveBeenCalledWith(
      'select status, processor_version from import_batches where id = $1 for update',
      [job.payload.batchId],
    );
    expect(client.query).toHaveBeenCalledWith('rollback');
  });
});
