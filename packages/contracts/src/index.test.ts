import { describe, expect, it } from 'vitest';
import {
  clinicalAuthorizationReferenceSchema,
  createPlanningPeriodRequestSchema,
  foundationJobSchema,
  legacyAuthorizationHistoryResponseSchema,
  loginRequestSchema,
  planningPeriodTransitions,
  transitionPlanningPeriodRequestSchema,
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
