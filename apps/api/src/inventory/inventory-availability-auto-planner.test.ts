import { describe, expect, it } from 'vitest';

import { planAutomaticAssignments } from './inventory-availability-auto-planner';

describe('automatic inventory assignment planner', () => {
  it('completes one authorization from several OCs using FEFO and receipt order', () => {
    const plan = planAutomaticAssignments(
      [
        {
          authorizationKey: 'AUTO-1',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          validityEndDate: '2026-12-31',
          pendingQuantity: 6,
        },
      ],
      [
        {
          purchaseOrderCode: 'OC-OLD',
          purchaseOrderId: '2',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          availableQuantity: 4,
          expirationDate: null,
          receivedAt: '2026-10-01T00:00:00Z',
        },
        {
          purchaseOrderCode: 'OC-FEFO',
          purchaseOrderId: '1',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          availableQuantity: 2,
          expirationDate: '2026-11-30',
          receivedAt: '2026-11-01T00:00:00Z',
        },
      ],
    );

    expect(plan.requests).toEqual([
      { authorizationKey: 'AUTO-1', purchaseOrderCode: 'OC-FEFO', quantity: 2 },
      { authorizationKey: 'AUTO-1', purchaseOrderCode: 'OC-OLD', quantity: 4 },
    ]);
    expect(plan.assignedAuthorizationKeys).toEqual(['AUTO-1']);
    expect(plan.unmatchedStock).toEqual([]);
  });

  it('skips an incomplete earlier AUTO and fully assigns the next AUTO that fits', () => {
    const plan = planAutomaticAssignments(
      [
        {
          authorizationKey: 'AUTO-1',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          validityEndDate: '2026-11-20',
          pendingQuantity: 8,
        },
        {
          authorizationKey: 'AUTO-2',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          validityEndDate: '2026-11-21',
          pendingQuantity: 5,
        },
      ],
      [
        {
          purchaseOrderCode: 'OC-1',
          purchaseOrderId: '1',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          availableQuantity: 5,
          expirationDate: null,
          receivedAt: '2026-10-01T00:00:00Z',
        },
      ],
    );

    expect(plan.requests).toEqual([
      { authorizationKey: 'AUTO-2', purchaseOrderCode: 'OC-1', quantity: 5 },
    ]);
    expect(plan.assignedAuthorizationKeys).toEqual(['AUTO-2']);
    expect(plan.unmatchedStock).toEqual([]);
  });

  it('uses authorization key as a stable same-day tie-breaker and keeps stock at its point', () => {
    const plan = planAutomaticAssignments(
      [
        {
          authorizationKey: 'AUTO-Z',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          validityEndDate: '2026-11-20',
          pendingQuantity: 2,
        },
        {
          authorizationKey: 'AUTO-A',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          validityEndDate: '2026-11-20',
          pendingQuantity: 2,
        },
        {
          authorizationKey: 'AUTO-OTHER-POINT',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-2',
          validityEndDate: '2026-11-19',
          pendingQuantity: 2,
        },
      ],
      [
        {
          purchaseOrderCode: 'OC-1',
          purchaseOrderId: '1',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          availableQuantity: 2,
          expirationDate: null,
          receivedAt: '2026-10-01T00:00:00Z',
        },
      ],
    );

    expect(plan.requests).toEqual([
      { authorizationKey: 'AUTO-A', purchaseOrderCode: 'OC-1', quantity: 2 },
    ]);
    expect(plan.unmatchedStock).toEqual([]);
  });

  it('records why remaining product cannot be assigned at its current point', () => {
    const plan = planAutomaticAssignments(
      [
        {
          authorizationKey: 'AUTO-OTHER-POINT',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-2',
          validityEndDate: '2026-11-20',
          pendingQuantity: 2,
        },
      ],
      [
        {
          purchaseOrderCode: 'OC-1',
          purchaseOrderId: '1',
          commercialCode: 'MED-1',
          dispensingPointId: 'POINT-1',
          availableQuantity: 3,
          expirationDate: null,
          receivedAt: '2026-10-01T00:00:00Z',
        },
      ],
    );

    expect(plan.requests).toEqual([]);
    expect(plan.unmatchedStock).toEqual([
      {
        commercialCode: 'MED-1',
        dispensingPointId: 'POINT-1',
        quantity: 3,
        reason: 'NO_MATCHING_POINT',
      },
    ]);
  });
});
