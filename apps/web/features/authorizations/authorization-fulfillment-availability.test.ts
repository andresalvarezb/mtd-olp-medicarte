import { describe, expect, it } from 'vitest';
import {
  authorizationFulfillmentBlockMessage,
  canStartAuthorizationFulfillment,
} from './authorization-fulfillment-availability';

const reservedAuthorization = {
  canManage: true,
  expiryAttentionStatus: 'CURRENT',
  operationalStatus: 'ASSIGNED',
  remainingAuthorizedQuantity: 20,
  remainingAssignedQuantity: 12,
  activePurchaseOrderCount: 1,
};

describe('authorization fulfillment availability', () => {
  it('offers fulfillment for a current authorization with active reservation', () => {
    expect(canStartAuthorizationFulfillment(reservedAuthorization)).toBe(true);
    expect(authorizationFulfillmentBlockMessage('CURRENT')).toBeNull();
  });

  it.each(['GRACE', 'PARTIAL_CONTINUATION'])(
    'allows fulfillment during %s when a reservation remains',
    (status) => {
      expect(
        canStartAuthorizationFulfillment({
          ...reservedAuthorization,
          expiryAttentionStatus: status,
        }),
      ).toBe(true);
    },
  );

  it('blocks an authorization without prior attention after grace while preserving history detail', () => {
    expect(
      canStartAuthorizationFulfillment({
        ...reservedAuthorization,
        expiryAttentionStatus: 'BLOCKED_AFTER_GRACE',
      }),
    ).toBe(false);
    expect(authorizationFulfillmentBlockMessage('BLOCKED_AFTER_GRACE')).toMatch(
      /cinco días de gracia/,
    );
    expect(reservedAuthorization.remainingAssignedQuantity).toBe(12);
  });

  it('blocks completed authorizations even when the backend shows old reservations', () => {
    expect(
      canStartAuthorizationFulfillment({
        ...reservedAuthorization,
        expiryAttentionStatus: 'COMPLETE',
      }),
    ).toBe(false);
    expect(authorizationFulfillmentBlockMessage('COMPLETE')).toMatch(
      /agotó la cantidad autorizada/,
    );
  });
});
