import { describe, expect, it } from 'vitest';
import {
  OrganizationRolePolicyError,
  assertRoleAllowedForOrganization,
  findInvalidRoleAssignments,
  isPredefinedRole,
  isRoleAllowedForOrganization,
} from './organization-role-policy';

describe('ESP-020 organization-role policy', () => {
  it('accepts only the approved organization-role matrix', () => {
    expect(isRoleAllowedForOrganization('MTD', 'MTD_ADMIN')).toBe(true);
    expect(isRoleAllowedForOrganization('MEDICARTE', 'MEDICARTE_OPERATOR')).toBe(true);
    expect(isRoleAllowedForOrganization('OLP', 'OLP_OPERATOR')).toBe(true);
    expect(isRoleAllowedForOrganization('COMPENSAR', 'COMPENSAR_VIEWER')).toBe(true);
    expect(isRoleAllowedForOrganization('MTD', 'MEDICARTE_OPERATOR')).toBe(false);
    expect(isRoleAllowedForOrganization('OLP', 'MTD_ADMIN')).toBe(false);
  });

  it('rejects invalid assignments before persistence', () => {
    expect(() => assertRoleAllowedForOrganization('MEDICARTE', 'MTD_ADMIN')).toThrow(
      OrganizationRolePolicyError,
    );
  });

  it('reports historical invalid assignments without mutating them', () => {
    const invalid = findInvalidRoleAssignments([
      { organizationCode: 'MTD', roleCode: 'MTD_ADMIN' },
      { organizationCode: 'MEDICARTE', roleCode: 'MTD_ADMIN' },
      { organizationCode: 'UNKNOWN', roleCode: 'CUSTOM_ROLE' },
      { organizationCode: 'OLP', roleCode: 'MTD_ADMIN', active: false },
    ]);
    expect(invalid).toEqual([
      { organizationCode: 'MEDICARTE', roleCode: 'MTD_ADMIN' },
      { organizationCode: 'UNKNOWN', roleCode: 'CUSTOM_ROLE' },
    ]);
  });

  it('does not introduce custom roles', () => {
    expect(isPredefinedRole('MTD_ADMIN')).toBe(true);
    expect(isPredefinedRole('CUSTOM_ROLE')).toBe(false);
  });
});
