import { describe, expect, it } from 'vitest';
import {
  authorizationImportJobSchema,
  confirmImportResponseSchema,
  foundationJobSchema,
  importBatchResponseSchema,
  importRowResultCodeSchema,
} from './index';

describe('foundationJobSchema', () => {
  it('rejects an unversioned job', () => {
    expect(() => foundationJobSchema.parse({ name: 'foundation.event' })).toThrow();
  });
});

describe('phase two contracts', () => {
  it('accepts a versioned import job and only approved row result codes', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    expect(authorizationImportJobSchema.parse({
      name: 'authorization.import',
      version: 1,
      payload: {
        eventId: id,
        batchId: id,
        sourceFileId: id,
        processorVersion: 1,
        correlationId: id,
        idempotencyKey: 'import-key-1',
      },
      correlationId: id,
      idempotencyKey: 'import-key-1',
    }).name).toBe('authorization.import');
    expect(importRowResultCodeSchema.safeParse('DUPLICATE_IN_FILE').success).toBe(true);
    expect(importRowResultCodeSchema.safeParse('TECHNICAL_EXCEPTION_MESSAGE').success).toBe(false);
  });

  it('requires a stable nullable import error code and ISO datetimes', () => {
    const batch = {
      id: '10000000-0000-4000-8000-000000000001',
      status: 'FAILED',
      originalFilename: 'authorizations.csv',
      mimeType: 'text/csv',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
      totalRows: 1,
      validRows: 0,
      rejectedRows: 1,
      duplicateRows: 0,
      existingRows: 0,
      confirmedRows: 0,
      lastErrorCode: 'PROCESSING_ERROR',
      createdAt: '2026-08-28T12:00:00.000Z',
      completedAt: '2026-08-28T12:00:01.000Z',
    };

    expect(importBatchResponseSchema.parse(batch).lastErrorCode).toBe('PROCESSING_ERROR');
    expect(importBatchResponseSchema.parse({ ...batch, lastErrorCode: null }).lastErrorCode).toBeNull();
    expect(importBatchResponseSchema.safeParse({ ...batch, lastErrorCode: undefined }).success).toBe(false);
    expect(importBatchResponseSchema.safeParse({ ...batch, createdAt: '2026-08-28' }).success).toBe(false);
    expect(confirmImportResponseSchema.safeParse({
      batchId: batch.id,
      status: 'COMPLETED',
      createdRows: 1,
      existingRows: 0,
      confirmedAt: 'not-a-date',
    }).success).toBe(false);
  });
});
