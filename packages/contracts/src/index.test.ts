import { describe, expect, it } from 'vitest';
import { canonicalizeHeader, sanitizeHeader } from './headers';

describe('catalogo de encabezados', () => {
  it('sanitiza mayusculas, tildes, eñe, separadores y guiones bajos', () => {
    expect(sanitizeHeader('  Fecha de Aplicación (Medicamento)  ')).toBe(
      'FECHA_DE_APLICACION_MEDICAMENTO',
    );
    expect(sanitizeHeader('  Año__de prueba  ')).toBe('ANO_DE_PRUEBA');
  });

  it('mapea aliases legacy al encabezado canonico', () => {
    expect(canonicalizeHeader('Código-Producto')).toBe('CODIGO_PRODUCTO');
    expect(canonicalizeHeader('No.PRESCRIPCION')).toBe('NUMERO_PRESCRIPCION');
    expect(canonicalizeHeader('authorization_key')).toBe('CLAVE_AUTORIZACION');
  });
});
import {
  admissionStatusSchema,
  auditReviewResponseSchema,
  authorizationImportJobSchema,
  authorizationItemListQuerySchema,
  bulkUpdateOperationContracts,
  bulkUpdateOperationTypeSchema,
  bulkUpdateRowResultCodeSchema,
  confirmImportResponseSchema,
  consolidatedExportQuerySchema,
  enabledBulkUpdateOperationTypes,
  foundationJobSchema,
  importBatchResponseSchema,
  importRowResultCodeSchema,
  operationalIndicatorsResponseSchema,
  rejectAuditReviewRequestSchema,
  loginRequestSchema,
  usernameSchema,
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
      originalFilename: 'authorizations.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
      'ASSIGN_PURCHASE_ORDER',
      'REPORT_DISPENSATION_DATE',
      'REPORT_APPLICATION_DATE',
    ]);
    expect(bulkUpdateOperationContracts.ASSIGN_DISPENSATION_LOCATION).toMatchObject({
      actorOrganizationCode: 'MEDICARTE',
      mutableField: 'LUGAR_DISPENSACION',
      requiredColumns: [
        'CLAVE_AUTORIZACION',
        'LUGAR_DISPENSACION',
        'FECHA_PROGRAMADA',
      ],
    });
    expect(bulkUpdateOperationContracts.ASSIGN_PURCHASE_ORDER).toMatchObject({
      actorOrganizationCode: 'MTD',
      mutableField: 'ORDEN_COMPRA',
      requiredColumns: ['CLAVE_AUTORIZACION', 'ORDEN_COMPRA'],
    });
    expect(bulkUpdateOperationContracts.REPORT_APPLICATION_DATE.requiredColumns).toEqual([
      'CLAVE_AUTORIZACION',
      'FECHA_APLICACION',
      'COD_AUTORIZACION_MEDICARTE',
    ]);
    expect(bulkUpdateOperationContracts.REPORT_DISPENSATION_DATE).toMatchObject({
      actorOrganizationCode: 'OLP',
      mutableField: 'FECHA_DISPENSACION',
      requiredColumns: ['CLAVE_AUTORIZACION', 'FECHA_DISPENSACION'],
    });
    expect(bulkUpdateOperationContracts.REPORT_APPLICATION_DATE).toMatchObject({
      actorOrganizationCode: 'MEDICARTE',
      mutableField: 'FECHA_APLICACION',
       requiredColumns: ['CLAVE_AUTORIZACION', 'FECHA_APLICACION', 'COD_AUTORIZACION_MEDICARTE'],
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

});

describe('phase six contracts', () => {
  const uuid = '10000000-0000-4000-8000-000000000001';
  const review = {
    id: uuid,
    authorizationItemId: uuid,
    reviewNumber: 1,
    status: 'IN_REVIEW',
    observations: null,
    decidedBy: null,
    decidedAt: null,
    startedBy: uuid,
    startedAt: '2026-08-30T13:00:00.000Z',
    findings: [],
  };

  it('valida la revision de auditoria con hallazgos trazables', () => {
    expect(auditReviewResponseSchema.parse(review).status).toBe('IN_REVIEW');
    expect(
      auditReviewResponseSchema.safeParse({
        ...review,
        findings: [
          {
            id: uuid,
            code: 'SUPPORT_MISSING',
            description: 'Falta soporte',
            createdAt: '2026-08-30T13:05:00.000Z',
          },
        ],
      }).success,
    ).toBe(true);
    expect(auditReviewResponseSchema.safeParse({ ...review, reviewNumber: 0 }).success).toBe(false);
    expect(auditReviewResponseSchema.safeParse({ ...review, status: 'PENDING' }).success).toBe(
      false,
    );
  });

  it('exige observaciones al rechazar y admite aprobacion sin ellas', () => {
    expect(rejectAuditReviewRequestSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(
      rejectAuditReviewRequestSchema.safeParse({
        expectedVersion: 1,
        observations: 'Soporte incompleto',
      }).success,
    ).toBe(true);
  });

  it('filtra la bandeja por auditStatus y deriva admissionStatus cerrado', () => {
    expect(authorizationItemListQuerySchema.parse({ auditStatus: 'READY' }).auditStatus).toBe(
      'READY',
    );
    expect(authorizationItemListQuerySchema.safeParse({ auditStatus: 'PENDING' }).success).toBe(
      false,
    );
    expect(
      authorizationItemListQuerySchema.parse({ applicationSiteStatus: 'ASSIGNED' })
        .applicationSiteStatus,
    ).toBe('ASSIGNED');
    expect(
      authorizationItemListQuerySchema.safeParse({ applicationSiteStatus: 'OTHER' }).success,
    ).toBe(false);
    expect(admissionStatusSchema.options).toEqual(['NOT_READY', 'READY']);
  });

  it('valida indicadores operativos derivados', () => {
    const indicators = operationalIndicatorsResponseSchema.parse({
      byAuditStatus: { NOT_STARTED: 1, READY: 2, IN_REVIEW: 0, REJECTED: 0, APPROVED: 3 },
      byOperationStatus: {
        BLOCKED: 0,
        READY_TO_DISPENSE: 1,
        DISPENSATION_REPORTED: 2,
        DISPENSED: 3,
      },
      byCoverageType: { UNCLASSIFIED: 0, PBS: 4, NO_PBS: 2 },
      pendingDispensationLocation: 1,
      assignedDispensationLocation: 1,
      pendingDispensationDate: 2,
      pendingApplicationDate: 3,
      readyForReview: 2,
      approvedForAdmission: 3,
    });
    expect(indicators.approvedForAdmission).toBe(3);
    expect(
      operationalIndicatorsResponseSchema.safeParse({
        ...indicators,
        byAuditStatus: { INVALID: 1 },
      }).success,
    ).toBe(false);
  });

  it('restringe el consolidado bajo demanda a formatos cerrados', () => {
    expect(consolidatedExportQuerySchema.parse({}).format).toBe('xlsx');
    expect(consolidatedExportQuerySchema.parse({ includeAll: 'true' }).includeAll).toBe(true);
    expect(consolidatedExportQuerySchema.parse({ includeAll: 'false' }).includeAll).toBe(false);
    expect(consolidatedExportQuerySchema.safeParse({ format: 'pdf' }).success).toBe(false);
  });
});

describe('autenticación local (ADR-026)', () => {
  it('normaliza el username antes de validar: case-insensitive y con espacios', () => {
    expect(loginRequestSchema.parse({ username: '  ANA.Test ', password: 'x' }).username).toBe(
      'ana.test',
    );
    expect(usernameSchema.parse('FOUNDATION-ADMIN')).toBe('foundation-admin');
  });

  it('rechaza formatos de username inválidos tras normalizar', () => {
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('ana test').success).toBe(false);
    expect(usernameSchema.safeParse('.ana').success).toBe(false);
    expect(usernameSchema.safeParse('ana+tag').success).toBe(false);
  });
});
