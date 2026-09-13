import { describe, expect, it } from 'vitest';
import {
  PATIENT_SCHEDULE_IDENTITY_FIELDS,
  SCHEDULE_EXPIRATION_THRESHOLDS,
  clinicalAuthorizationReferenceSchema,
  createPatientScheduleRequestSchema,
  createPlanningPeriodRequestSchema,
  foundationJobSchema,
  legacyAuthorizationHistoryResponseSchema,
  loginRequestSchema,
  patientScheduleTransitions,
  planningPeriodTransitions,
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
    expect(
      reschedulePatientScheduleRequestSchema.safeParse({ expectedRevision: 2 }).success,
    ).toBe(false);
  });

  it('shares the expiration thresholds and the schedule state machine', () => {
    expect(SCHEDULE_EXPIRATION_THRESHOLDS).toEqual({ criticalDays: 15, highDays: 30 });
    expect(patientScheduleTransitions.SCHEDULED).toEqual(['RESCHEDULED', 'CANCELLED']);
    expect(patientScheduleTransitions.RESCHEDULED).toEqual(['RESCHEDULED', 'CANCELLED']);
    expect(patientScheduleTransitions.CANCELLED).toEqual([]);
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
