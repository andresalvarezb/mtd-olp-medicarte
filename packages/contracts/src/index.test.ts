import { describe, expect, it } from 'vitest';
import {
  authorizationImportJobSchema,
  bulkUpdateOperationContracts,
  bulkUpdateOperationTypeSchema,
  bulkUpdateRowResultCodeSchema,
  confirmImportResponseSchema,
  enabledBulkUpdateOperationTypes,
  foundationJobSchema,
  importBatchResponseSchema,
  importRowResultCodeSchema,
  notificationJobSchema,
  notificationRecipientOrganizations,
} from './index';

describe('foundationJobSchema', () => {
  it('rejects an unversioned job', () => {
    expect(() => foundationJobSchema.parse({ name: 'foundation.event' })).toThrow();
  });
});

describe('phase two contracts', () => {
  it('accepts a versioned import job and only approved row result codes', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    expect(
      authorizationImportJobSchema.parse({
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
      }).name,
    ).toBe('authorization.import');
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
    expect(
      importBatchResponseSchema.parse({ ...batch, lastErrorCode: null }).lastErrorCode,
    ).toBeNull();
    expect(
      importBatchResponseSchema.safeParse({ ...batch, lastErrorCode: undefined }).success,
    ).toBe(false);
    expect(importBatchResponseSchema.safeParse({ ...batch, createdAt: '2026-08-28' }).success).toBe(
      false,
    );
    expect(
      confirmImportResponseSchema.safeParse({
        batchId: batch.id,
        status: 'COMPLETED',
        createdRows: 1,
        existingRows: 0,
        confirmedAt: 'not-a-date',
      }).success,
    ).toBe(false);
  });
});

describe('phase four and five contracts', () => {
  it('mantiene el catálogo cerrado de ADR-022 con actor y columna por tipo', () => {
    expect(bulkUpdateOperationTypeSchema.options).toEqual([
      'ASSIGN_DISPENSATION_LOCATION',
      'REPORT_DISPENSATION_DATE',
      'REPORT_APPLICATION_DATE',
    ]);
    expect(bulkUpdateOperationContracts.ASSIGN_DISPENSATION_LOCATION).toMatchObject({
      actorOrganizationCode: 'MEDICARTE',
      mutableField: 'lugar_dispensacion',
    });
    expect(bulkUpdateOperationContracts.REPORT_DISPENSATION_DATE).toMatchObject({
      actorOrganizationCode: 'OLP',
      mutableField: 'fecha_dispensacion',
    });
  });

  it('en Fase 5 habilita los tres tipos cerrados', () => {
    expect(enabledBulkUpdateOperationTypes).toEqual(bulkUpdateOperationTypeSchema.options);
    expect(bulkUpdateOperationContracts.REPORT_DISPENSATION_DATE.permission).toBe(
      'bulk_updates.dispensation_date',
    );
    expect(bulkUpdateOperationContracts.REPORT_APPLICATION_DATE.permission).toBe(
      'bulk_updates.application_date',
    );
  });

  it('conserva las causales estables de SPEC-013', () => {
    for (const code of [
      'UNCHANGED_VALUE',
      'INVALID_HEADERS',
      'MISSING_BUSINESS_KEY',
      'DUPLICATE_KEY_IN_FILE',
      'AUTHORIZATION_ITEM_NOT_FOUND',
      'FORBIDDEN_ITEM_SCOPE',
      'OPERATION_NOT_ALLOWED',
      'MISSING_VALUE',
      'INVALID_VALUE_FORMAT',
      'INVALID_OPERATION_STATE',
      'VERSION_CONFLICT',
    ]) {
      expect(bulkUpdateRowResultCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('valida el job de notificación y sus destinatarios', () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const job = notificationJobSchema.parse({
      name: 'notification.email',
      version: 1,
      payload: {
        eventId: id,
        notificationType: 'DISPENSATION_LOCATION_ASSIGNED',
        itemId: id,
        recipientOrganizationId: null,
        period: null,
        correlationId: id,
        idempotencyKey: 'location-key-1',
      },
      correlationId: id,
      idempotencyKey: 'location-key-1',
    });
    expect(job.payload.notificationType).toBe('DISPENSATION_LOCATION_ASSIGNED');
    expect(notificationRecipientOrganizations.AUTHORIZATION_READY_TO_DISPENSE).toEqual([
      'OLP',
      'MEDICARTE',
    ]);
    expect(notificationRecipientOrganizations.DISPENSATION_LOCATION_CHANGED).toEqual(['OLP']);
    expect(
      notificationJobSchema.safeParse({
        name: 'notification.email',
        version: 1,
        payload: { eventId: id, notificationType: 'OTHER' },
        correlationId: id,
        idempotencyKey: 'bad-key-1',
      }).success,
    ).toBe(false);
  });
});
