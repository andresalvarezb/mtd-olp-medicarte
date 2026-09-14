import { describe, expect, it } from 'vitest';
import {
  PATIENT_SCHEDULE_IDENTITY_FIELDS,
  SCHEDULE_EXPIRATION_THRESHOLDS,
  analyticsMoneyMetricSchema,
  analyticsRatioMetricSchema,
  applicationAuditRejectionCodeSchema,
  applicationAuditStatusSchema,
  clinicalAuthorizationReferenceSchema,
  createPatientScheduleRequestSchema,
  createPlanningPeriodRequestSchema,
  foundationJobSchema,
  legacyAuthorizationHistoryResponseSchema,
  loginRequestSchema,
  operationalAnalyticsResponseSchema,
  patientScheduleTransitions,
  planningPeriodTransitions,
  projectedDemandLineResponseSchema,
  rejectApplicationAuditRequestSchema,
  reschedulePatientScheduleRequestSchema,
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
