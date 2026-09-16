import { describe, expect, it } from 'vitest';
import {
  ActorBoundaryPolicyError,
  assertPermissionAllowedForActor,
  isPermissionAllowedForActor,
} from './actor-boundary-policy';

describe('ESP-020 actor boundaries', () => {
  it('keeps actor-specific capabilities inside their actor', () => {
    expect(
      isPermissionAllowedForActor('OLP', 'OLP_OPERATOR', 'purchase_orders.review_supplier'),
    ).toBe(true);
    expect(
      isPermissionAllowedForActor('MTD', 'MTD_OPERATOR', 'purchase_orders.review_supplier'),
    ).toBe(false);
    expect(isPermissionAllowedForActor('MEDICARTE', 'MEDICARTE_OPERATOR', 'inventory.read')).toBe(
      true,
    );
    expect(isPermissionAllowedForActor('OLP', 'OLP_OPERATOR', 'inventory.read')).toBe(false);
  });

  it('allows the MTD administrator global point semantics without granting OLP-only actions', () => {
    expect(isPermissionAllowedForActor('MTD', 'MTD_ADMIN', 'patient_schedules.read')).toBe(true);
    expect(isPermissionAllowedForActor('MTD', 'MTD_ADMIN', 'purchase_orders.review_supplier')).toBe(
      false,
    );
  });

  it('throws a typed error for a forbidden actor capability', () => {
    expect(() =>
      assertPermissionAllowedForActor('OLP', 'OLP_OPERATOR', 'patient_applications.manage'),
    ).toThrow(ActorBoundaryPolicyError);
  });
});
