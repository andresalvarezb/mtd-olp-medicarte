import { describe, expect, it } from 'vitest';
import {
  PATIENT_SCHEDULE_IDENTITY_FIELDS,
  SCHEDULE_EXPIRATION_THRESHOLDS,
  analyticsMoneyMetricSchema,
  analyticsRatioMetricSchema,
  applicationAuditRejectionCodeSchema,
  applicationAuditStatusSchema,
  bulkImportJobResponseSchema,
  clinicalAuthorizationReferenceSchema,
  createPatientScheduleRequestSchema,
  createPlanningPeriodRequestSchema,
  acceptReconciliationIssueRiskRequestSchema,
  createReconciliationIssueCommentRequestSchema,
  createReconciliationRunRequestSchema,
  resolveReconciliationIssueRequestSchema,
  upsertReconciliationOperationPolicyRequestSchema,
  reconciliationOperationExecutionResponseSchema,
  reconciliationNotificationResponseSchema,
  ESP014_SCHEDULING_TEMPLATE_VERSION,
  POINT_ACCESS_DENIED,
  foundationJobSchema,
  meResponseSchema,
  replaceOperationalPointScopeRequestSchema,
  legacyAuthorizationHistoryResponseSchema,
  loginRequestSchema,
  operationalAnalyticsResponseSchema,
  patientScheduleTransitions,
  planningPeriodTransitions,
  projectedDemandLineResponseSchema,
  rejectApplicationAuditRequestSchema,
  reschedulePatientScheduleRequestSchema,
  SCHEDULING_TEMPLATE_REQUIRED_COLUMNS,
  transitionPlanningPeriodRequestSchema,
  updatePatientScheduleRequestSchema,
  usernameSchema,
} from './index';

describe('foundation contracts', () => {
  it('requires a versioned event', () => {
    expect(() => foundationJobSchema.parse({ name: 'foundation.event' })).toThrow();
  });

  it('normalizes usernames before validation', () => {
    expect(usernameSchema.parse(' Admin.User ')).toBe('admin.user');
    expect(loginRequestSchema.safeParse({ username: 'admin', password: '' }).success).toBe(false);
  });

  it('separates clinical references from legacy operational history', () => {
    expect(
      clinicalAuthorizationReferenceSchema.parse({
        authorizationItemId: '10000000-0000-4000-8000-000000000001',
        commercialCode: ' cod001 ',
      }),
    ).toEqual({
      authorizationItemId: '10000000-0000-4000-8000-000000000001',
      commercialCode: 'COD001',
    });
    expect(
      legacyAuthorizationHistoryResponseSchema.safeParse({
        id: '10000000-0000-4000-8000-000000000001',
        numeroAutorizacion: 'AUTH-1',
        commercialCode: 'COD001',
        lugarDispensacion: null,
        fechaProgramada: null,
        fechaDispensacion: null,
        fechaAplicacion: null,
        codAutorizacionMedicarte: null,
        ordenCompra: 'LEGACY-1',
        processStatus: null,
        operationStatus: null,
        operationalVersion: 0,
        updatedAt: '2026-09-13T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('planning period contracts', () => {
  it('accepts a well-formed create request with offset datetimes', () => {
    const parsed = createPlanningPeriodRequestSchema.safeParse({
      startDate: '2031-03-03',
      endDate: '2031-03-09',
      schedulingCutoffAt: '2031-03-04T23:59:00-05:00',
      purchaseOrderDeadlineAt: '2031-03-05T23:59:00-05:00',
      expectedDeliveryDate: '2031-03-10',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects calendar dates without format and unknown transition states', () => {
    expect(
      createPlanningPeriodRequestSchema.safeParse({
        startDate: '03/03/2031',
        endDate: '2031-03-09',
        schedulingCutoffAt: '2031-03-04T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-03-05T23:59:00-05:00',
        expectedDeliveryDate: '2031-03-10',
      }).success,
    ).toBe(false);
    expect(
      transitionPlanningPeriodRequestSchema.safeParse({ to: 'CANCELLED', expectedVersion: 1 })
        .success,
    ).toBe(false);
  });

  it('keeps the state machine forward-only and CLOSED terminal', () => {
    expect(planningPeriodTransitions.OPEN).toEqual(['PLANNING_CLOSED']);
    expect(planningPeriodTransitions.PLANNING_CLOSED).toEqual(['PURCHASING']);
    expect(planningPeriodTransitions.PURCHASING).toEqual(['IN_FULFILLMENT']);
    expect(planningPeriodTransitions.IN_FULFILLMENT).toEqual(['OPERATIONAL']);
    expect(planningPeriodTransitions.OPERATIONAL).toEqual(['CLOSED']);
    expect(planningPeriodTransitions.CLOSED).toEqual([]);
  });
});

describe('patient schedule contracts', () => {
  it('requires a positive quantity and known statuses', () => {
    const base = {
      authorizationItemId: '10000000-0000-4000-8000-000000000001',
      commercialCode: ' cod001 ',
      dispensingPointId: '10000000-0000-4000-8000-000000000002',
      scheduledDate: '2031-03-05',
      quantity: 2,
    };
    expect(createPatientScheduleRequestSchema.safeParse(base).success).toBe(true);
    expect(createPatientScheduleRequestSchema.safeParse({ ...base, quantity: 0 }).success).toBe(
      false,
    );
    expect(createPatientScheduleRequestSchema.safeParse({ ...base, quantity: -1 }).success).toBe(
      false,
    );
    expect(
      createPatientScheduleRequestSchema.safeParse({ ...base, lateHandling: 'APPLIED' }).success,
    ).toBe(false);
  });

  it('normalizes the commercial code and requires at least one change on update', () => {
    const parsed = createPatientScheduleRequestSchema.parse({
      authorizationItemId: '10000000-0000-4000-8000-000000000001',
      commercialCode: ' cod001 ',
      dispensingPointId: '10000000-0000-4000-8000-000000000002',
      scheduledDate: '2031-03-05',
      quantity: 2,
    });
    expect(parsed.commercialCode).toBe('COD001');
    expect(updatePatientScheduleRequestSchema.safeParse({ expectedRevision: 1 }).success).toBe(
      false,
    );
    expect(
      updatePatientScheduleRequestSchema.safeParse({ expectedRevision: 1, quantity: 3 }).success,
    ).toBe(true);
  });

  it('reschedule always requires a date and version', () => {
    expect(
      reschedulePatientScheduleRequestSchema.safeParse({
        expectedRevision: 2,
        scheduledDate: '2031-03-06',
      }).success,
    ).toBe(true);
    expect(reschedulePatientScheduleRequestSchema.safeParse({ expectedRevision: 2 }).success).toBe(
      false,
    );
  });

  it('shares the expiration thresholds and the schedule state machine', () => {
    expect(SCHEDULE_EXPIRATION_THRESHOLDS).toEqual({ criticalDays: 15, highDays: 30 });
    expect(patientScheduleTransitions.SCHEDULED).toEqual(['RESCHEDULED', 'CANCELLED']);
    expect(patientScheduleTransitions.RESCHEDULED).toEqual(['RESCHEDULED', 'CANCELLED']);
    expect(patientScheduleTransitions.CANCELLED).toEqual([]);
  });

  it('demand contracts require positive quantities and the split invariant', () => {
    const line = {
      id: '10000000-0000-4000-8000-00000000000a',
      planningPeriodId: '10000000-0000-4000-8000-000000000001',
      planningPeriodStartDate: '2031-03-03',
      planningPeriodEndDate: '2031-03-09',
      dispensingPointId: '10000000-0000-4000-8000-000000000002',
      dispensingPointCode: 'P-01',
      dispensingPointName: 'Punto 1',
      commercialCode: 'COD001',
      regularQuantity: 5,
      lateQuantity: 6,
      projectedQuantity: 11,
      sourceCount: 4,
      status: 'OPEN' as const,
      revision: 2,
      consolidatedAt: '2026-09-13T12:00:00.000Z',
      createdBy: '10000000-0000-4000-8000-000000000003',
      updatedBy: '10000000-0000-4000-8000-000000000003',
    };
    expect(projectedDemandLineResponseSchema.safeParse(line).success).toBe(true);
    const broken = { ...line, projectedQuantity: 10, regularQuantity: 5, lateQuantity: 4 };
    expect(projectedDemandLineResponseSchema.safeParse(broken).success).toBe(false);
  });

  it('codifies the canonical schedule identity (one active schedule per identity)', () => {
    expect(PATIENT_SCHEDULE_IDENTITY_FIELDS).toEqual([
      'authorizationItemId',
      'dispensingPointId',
      'scheduledDate',
    ]);
    // quantity y revision NUNCA distinguen ocurrencias de programación.
    expect(PATIENT_SCHEDULE_IDENTITY_FIELDS).not.toContain('quantity');
    expect(PATIENT_SCHEDULE_IDENTITY_FIELDS).not.toContain('revision');
  });
});

describe('application audit contracts', () => {
  it('keeps READY_FOR_AUDIT as a read-model status and persists only review decisions', () => {
    expect(applicationAuditStatusSchema.options).toEqual([
      'READY_FOR_AUDIT',
      'IN_REVIEW',
      'APPROVED',
      'REJECTED',
    ]);
    expect(applicationAuditRejectionCodeSchema.options).toEqual([
      'APPLICATION_DATA_INCONSISTENT',
      'AUTHORIZATION_INCONSISTENT',
      'QUANTITY_INCONSISTENT',
      'PRODUCT_INCONSISTENT',
      'SUPPORT_MISSING',
      'OTHER',
    ]);
  });

  it('requires observation when the rejection code is OTHER', () => {
    expect(
      rejectApplicationAuditRequestSchema.safeParse({
        expectedVersion: 1,
        rejectionCode: 'SUPPORT_MISSING',
      }).success,
    ).toBe(true);
    expect(
      rejectApplicationAuditRequestSchema.safeParse({
        expectedVersion: 1,
        rejectionCode: 'OTHER',
      }).success,
    ).toBe(false);
    expect(
      rejectApplicationAuditRequestSchema.safeParse({
        expectedVersion: 1,
        rejectionCode: 'OTHER',
        observation: 'Falta el soporte de aplicación',
      }).success,
    ).toBe(true);
  });
});

describe('ESP-013 analytics contracts', () => {
  it('serializes money as decimal strings and keeps unavailable values null', () => {
    expect(
      analyticsMoneyMetricSchema.parse({
        availability: 'EXACT',
        value: '12.50',
        reason: null,
        basis: 'PURCHASE_ORDER_SNAPSHOT',
      }).value,
    ).toBe('12.50');
    expect(
      analyticsMoneyMetricSchema.safeParse({
        availability: 'EXACT',
        value: 12.5,
        reason: null,
        basis: null,
      }).success,
    ).toBe(false);
    expect(
      analyticsMoneyMetricSchema.parse({
        availability: 'UNAVAILABLE',
        value: null,
        reason: 'HISTORICAL_TARIFF_UNAVAILABLE',
        basis: null,
      }),
    ).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: 'HISTORICAL_TARIFF_UNAVAILABLE',
      basis: null,
    });
  });

  it('keeps zero-denominator rates as null instead of 0%', () => {
    expect(
      analyticsRatioMetricSchema.parse({ numerator: 4, denominator: 0, rate: null }).rate,
    ).toBeNull();
    expect(Object.keys(operationalAnalyticsResponseSchema.shape.inventory.shape)).toContain(
      'currentOnHandQuantity',
    );
    expect(Object.keys(operationalAnalyticsResponseSchema.shape.inventory.shape)).not.toContain(
      'periodLeftover',
    );
    expect(Object.keys(operationalAnalyticsResponseSchema.shape.procurement.shape)).toEqual(
      expect.arrayContaining(['effectivePurchaseCoverage', 'requestedQuantity']),
    );
    expect(operationalAnalyticsResponseSchema.shape.funnel.shape).toHaveProperty(
      'requestedQuantity',
    );
    expect(operationalAnalyticsResponseSchema.shape.funnel.shape).not.toHaveProperty(
      'effectivePurchaseCoverage',
    );
  });
});

describe('ESP-014 bulk import contracts', () => {
  it('keeps scheduling template version and columns in one contract', () => {
    expect(ESP014_SCHEDULING_TEMPLATE_VERSION).toBe('ESP014_SCHEDULING_V1');
    expect(SCHEDULING_TEMPLATE_REQUIRED_COLUMNS).toEqual([
      'AUTORIZACION',
      'DOCUMENTO',
      'COD_COMERCIAL',
      'CANTIDAD',
      'PUNTO',
      'FECHA_PROGRAMADA',
    ]);
    expect(
      bulkImportJobResponseSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        importType: 'SCHEDULING',
        templateVersion: ESP014_SCHEDULING_TEMPLATE_VERSION,
        status: 'READY',
        originalFilename: 'programacion.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 12,
        fileHash: 'a'.repeat(64),
        duplicateFile: false,
        totalRows: 2,
        validRows: 1,
        invalidRows: 1,
        duplicateRows: 0,
        warningRows: 0,
        createRows: 1,
        conflictRows: 0,
        succeededRows: 0,
        failedRows: 0,
        skippedRows: 0,
        lastErrorCode: null,
        createdAt: '2026-09-14T12:00:00.000Z',
        validatedAt: '2026-09-14T12:00:01.000Z',
        confirmedAt: null,
        completedAt: null,
        cancelledAt: null,
      }).status,
    ).toBe('READY');
  });
});

describe('ESP-015 operational point scope contracts', () => {
  it('attaches pointAccess to each organization in /me', () => {
    const parsed = meResponseSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      username: 'medicarte-operator',
      displayName: 'Medicarte Operator',
      mustChangePassword: false,
      organizations: [
        {
          id: '10000000-0000-4000-8000-000000000004',
          code: 'MEDICARTE',
          name: 'Medicarte',
          roles: ['MEDICARTE_OPERATOR'],
          permissions: ['patient_schedules.manage'],
          pointAccess: { kind: 'explicit', accessiblePointIds: [] },
        },
      ],
    });
    expect(parsed.organizations[0]?.pointAccess).toEqual({
      kind: 'explicit',
      accessiblePointIds: [],
    });
  });

  it('replaces the complete point set and keeps POINT_ACCESS_DENIED stable', () => {
    expect(
      replaceOperationalPointScopeRequestSchema.parse({
        pointIds: ['00000000-0000-4000-8000-000000000011'],
      }).pointIds,
    ).toHaveLength(1);
    expect(
      replaceOperationalPointScopeRequestSchema.safeParse({ pointIds: ['not-a-uuid'] }).success,
    ).toBe(false);
    expect(POINT_ACCESS_DENIED).toBe('POINT_ACCESS_DENIED');
  });
});

describe('reconciliation contracts', () => {
  it('accepts an optional scoped run request', () => {
    expect(createReconciliationRunRequestSchema.parse({}).planningPeriodId).toBeUndefined();
    expect(
      createReconciliationRunRequestSchema.parse({
        planningPeriodId: '10000000-0000-4000-8000-000000000011',
        dispensingPointId: '10000000-0000-4000-8000-000000000012',
      }),
    ).toMatchObject({
      planningPeriodId: '10000000-0000-4000-8000-000000000011',
    });
  });

  it('requires expectedVersion and catalog resolution codes for governance actions', () => {
    expect(
      resolveReconciliationIssueRequestSchema.parse({
        expectedVersion: 1,
        resolutionCode: 'DATA_CORRECTED',
        resolutionNote: 'Corrected in the application module',
      }).resolutionCode,
    ).toBe('DATA_CORRECTED');
    expect(
      resolveReconciliationIssueRequestSchema.safeParse({
        expectedVersion: 1,
        resolutionCode: 'MUTE_RULE',
        resolutionNote: 'nope',
      }).success,
    ).toBe(false);
    expect(
      acceptReconciliationIssueRiskRequestSchema.parse({
        expectedVersion: 2,
        acceptedRiskReason: 'Known temporary lineage gap',
      }).acceptedRiskReason,
    ).toBe('Known temporary lineage gap');
    expect(
      createReconciliationIssueCommentRequestSchema.safeParse({
        body: `${'x'.repeat(2001)}`,
      }).success,
    ).toBe(false);
  });

  it('validates ESP-019 operations policy and execution schemas', () => {
    const validPolicy = upsertReconciliationOperationPolicyRequestSchema.parse({
      cadence: 'DAILY',
      localTime: '02:00',
      severityAlertThreshold: 'ERROR',
    });
    expect(validPolicy.cadence).toBe('DAILY');
    expect(validPolicy.localTime).toBe('02:00');
    expect(validPolicy.timezone).toBe('America/Bogota');
    expect(validPolicy.severityAlertThreshold).toBe('ERROR');

    // Rejects invalid time format
    expect(
      upsertReconciliationOperationPolicyRequestSchema.safeParse({
        cadence: 'DAILY',
        localTime: '25:00',
      }).success,
    ).toBe(false);

    // Rejects weekday > 7 or < 1
    expect(
      upsertReconciliationOperationPolicyRequestSchema.safeParse({
        cadence: 'WEEKLY',
        weekday: 8,
      }).success,
    ).toBe(false);

    const validExecution = reconciliationOperationExecutionResponseSchema.parse({
      id: '10000000-0000-4000-8000-000000000001',
      tenantId: '10000000-0000-4000-8000-000000000002',
      policyId: null,
      triggerType: 'MANUAL',
      scheduledFor: null,
      claimedAt: null,
      startedAt: null,
      completedAt: null,
      status: 'PENDING',
      reconciliationRunId: null,
      attemptCount: 0,
      claimToken: null,
      claimGeneration: 0,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      missedOccurrencesCount: 0,
      skipReason: null,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(validExecution.status).toBe('PENDING');

    const validNotification = reconciliationNotificationResponseSchema.parse({
      id: '10000000-0000-4000-8000-000000000001',
      tenantId: '10000000-0000-4000-8000-000000000002',
      executionId: null,
      reconciliationRunId: null,
      notificationType: 'RECONCILIATION_CRITICAL',
      severity: 'CRITICAL',
      dedupKey: 'RUN_HEALTH:123',
      status: 'SENT',
      channel: 'IN_APP',
      payload: { criticalFindings: 1 },
      attemptCount: 0,
      readAt: null,
      sentAt: '2026-09-15T00:00:00.000Z',
      lastErrorCode: null,
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    });
    expect(validNotification.notificationType).toBe('RECONCILIATION_CRITICAL');
  });
});
