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

  it('allows custom roles only within their assigned organization boundary', () => {
    expect(
      isPermissionAllowedForActor('OLP', 'CUSTOM_REGIONAL_123', 'purchase_orders.review_supplier'),
    ).toBe(true);
    expect(
      isPermissionAllowedForActor('MEDICARTE', 'CUSTOM_REGIONAL_123', 'supplier_deliveries.read'),
    ).toBe(true);
    expect(
      isPermissionAllowedForActor('MTD', 'CUSTOM_REGIONAL_123', 'purchase_orders.review_supplier'),
    ).toBe(false);
  });

  it('allows sensitive authorization reads in every supported organization', () => {
    for (const organization of ['MTD', 'MEDICARTE', 'OLP', 'COMPENSAR']) {
      expect(
        isPermissionAllowedForActor(
          organization,
          'CUSTOM_AUTHORIZATION_READER',
          'authorizations.read_sensitive',
        ),
      ).toBe(true);
    }

    expect(
      isPermissionAllowedForActor(
        'UNKNOWN',
        'CUSTOM_AUTHORIZATION_READER',
        'authorizations.read_sensitive',
      ),
    ).toBe(false);
  });

  it('throws a typed error for a forbidden actor capability', () => {
    expect(() =>
      assertPermissionAllowedForActor('OLP', 'OLP_OPERATOR', 'patient_applications.manage'),
    ).toThrow(ActorBoundaryPolicyError);
  });

  it('limits patient master and reconciliation to their explicit actor boundaries', () => {
    const patientPermissions = [
      'patient_master.read',
      'patient_master.personal.read',
      'patient_reconciliation.read',
    ];

    for (const permission of patientPermissions) {
      expect(isPermissionAllowedForActor('MTD', 'MTD_ADMIN', permission)).toBe(true);
      expect(isPermissionAllowedForActor('MTD', 'MTD_AUDITORIA', permission)).toBe(true);
      expect(isPermissionAllowedForActor('MEDICARTE', 'MEDICARTE_OPERATOR', permission)).toBe(
        false,
      );
      expect(isPermissionAllowedForActor('OLP', 'OLP_OPERATOR', permission)).toBe(false);
    }
  });
});
