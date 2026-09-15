import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BULK_IMPORT_MAX_COLUMNS,
  BULK_IMPORT_MAX_FILE_BYTES,
  BULK_IMPORT_MAX_ROWS,
  ESP014_SCHEDULING_TEMPLATE_VERSION,
  assertBulkImportJobTransition,
  canCancelBulkImportJob,
  canCompleteBulkImportRowClaim,
  canConfirmBulkImportJob,
  canRetryFailedBulkImportJob,
  decideBulkImportCompletion,
  findInternalSchedulingDuplicates,
  initialExecutionStatus,
  isExpiredBulkImportClaim,
  isSupportedSchedulingTemplate,
  phiSafeBulkImportLog,
  rowIdempotencyKey,
  schedulingIdentityKey,
} from './bulk-import';

describe('ESP-014 bulk import state machines', () => {
  it('allows confirm only from READY', () => {
    expect(canConfirmBulkImportJob('READY')).toBe(true);
    expect(canConfirmBulkImportJob('INVALID')).toBe(false);
    expect(canConfirmBulkImportJob('PROCESSING')).toBe(false);
  });

  it('allows cancel before execution and forbids it during PROCESSING', () => {
    expect(canCancelBulkImportJob('UPLOADED')).toBe(true);
    expect(canCancelBulkImportJob('READY')).toBe(true);
    expect(canCancelBulkImportJob('PROCESSING')).toBe(false);
  });

  it('retries FAILED rows from PARTIALLY_COMPLETED or FAILED', () => {
    expect(canRetryFailedBulkImportJob('PARTIALLY_COMPLETED')).toBe(true);
    expect(canRetryFailedBulkImportJob('FAILED')).toBe(true);
    expect(canRetryFailedBulkImportJob('COMPLETED')).toBe(false);
    expect(initialExecutionStatus('VALID')).toBe('PENDING');
    expect(initialExecutionStatus('INVALID')).toBe('SKIPPED');
  });

  it('rejects illegal job transitions', () => {
    expect(() => assertBulkImportJobTransition('COMPLETED', 'READY')).toThrow(
      'INVALID_JOB_TRANSITION',
    );
    assertBulkImportJobTransition('READY', 'PROCESSING');
  });

  it('marks mixed execution as partial success and all-failed as FAILED', () => {
    expect(decideBulkImportCompletion({ succeeded: 95, failed: 5, pending: 0 })).toBe(
      'PARTIALLY_COMPLETED',
    );
    expect(decideBulkImportCompletion({ succeeded: 100, failed: 0, pending: 0 })).toBe('COMPLETED');
    expect(decideBulkImportCompletion({ succeeded: 0, failed: 5, pending: 0 })).toBe('FAILED');
    expect(decideBulkImportCompletion({ succeeded: 1, failed: 0, pending: 1 })).toBe('PROCESSING');
  });
});

describe('ESP-014 template and file facts', () => {
  it('accepts only the current scheduling template version', () => {
    expect(isSupportedSchedulingTemplate(ESP014_SCHEDULING_TEMPLATE_VERSION)).toBe(true);
    expect(isSupportedSchedulingTemplate('ESP014_SCHEDULING_V0')).toBe(false);
    expect(isSupportedSchedulingTemplate(null)).toBe(false);
  });

  it('keeps MVP limits in one place', () => {
    expect(BULK_IMPORT_MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(BULK_IMPORT_MAX_ROWS).toBe(5000);
    expect(BULK_IMPORT_MAX_COLUMNS).toBe(20);
  });

  it('hashes file bytes deterministically', () => {
    const hash = createHash('sha256').update('same-xlsx').digest('hex');
    expect(createHash('sha256').update('same-xlsx').digest('hex')).toBe(hash);
    expect(createHash('sha256').update('other').digest('hex')).not.toBe(hash);
  });
});

describe('ESP-014 duplicate identity and PHI-safe logs', () => {
  it('detects duplicated schedule identity inside the same workbook', () => {
    const duplicates = findInternalSchedulingDuplicates([
      {
        rowNumber: 5,
        authorizationNumber: 'A-1',
        commercialCode: 'P1',
        dispensingPoint: 'PT1',
        scheduledDate: '2034-03-15',
      },
      {
        rowNumber: 20,
        authorizationNumber: 'a-1',
        commercialCode: 'p1',
        dispensingPoint: 'pt1',
        scheduledDate: '2034-03-15',
      },
    ]);
    expect([...duplicates].sort((left, right) => left - right)).toEqual([5, 20]);
  });

  it('builds a stable row idempotency key', () => {
    expect(rowIdempotencyKey('job', 8)).toBe('job:8');
    expect(
      schedulingIdentityKey({
        authorizationNumber: 'A',
        commercialCode: 'C',
        dispensingPoint: 'P',
        scheduledDate: '2034-01-01',
      }),
    ).toBe('A|C|P|2034-01-01');
  });

  it('omits PHI from log metadata', () => {
    const meta = phiSafeBulkImportLog({
      jobId: 'job-1',
      rowNumber: 8,
      errorCode: 'AUTHORIZATION_NOT_FOUND',
    });
    expect(JSON.stringify(meta)).not.toMatch(/documento|nombre|cedula/i);
    expect(meta).toEqual({
      jobId: 'job-1',
      rowNumber: 8,
      errorCode: 'AUTHORIZATION_NOT_FOUND',
    });
  });
});

describe('ESP-014 row claim fencing', () => {
  it('treats a missing claim lease as expired so crashed workers can be recovered', () => {
    expect(isExpiredBulkImportClaim(null)).toBe(true);
    expect(isExpiredBulkImportClaim(new Date(Date.now() - 1000))).toBe(true);
    expect(isExpiredBulkImportClaim(new Date(Date.now() + 60_000))).toBe(false);
  });

  it('rejects a stale claimant after a newer generation reclaims the row', () => {
    expect(
      canCompleteBulkImportRowClaim({
        storedToken: 'token-11',
        storedGeneration: 11,
        claimantToken: 'token-10',
        claimantGeneration: 10,
      }),
    ).toBe(false);
    expect(
      canCompleteBulkImportRowClaim({
        storedToken: 'token-11',
        storedGeneration: 11,
        claimantToken: 'token-11',
        claimantGeneration: 11,
      }),
    ).toBe(true);
  });
});
