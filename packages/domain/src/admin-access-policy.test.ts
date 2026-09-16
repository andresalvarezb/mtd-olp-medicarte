import { describe, expect, it } from 'vitest';
import {
  effectivePermissionCodes,
  isAllowAllAdministrator,
  isPermissionGrantedByAllowAll,
} from './admin-access-policy';

describe('ESP-020 administrator access policy', () => {
  const admin = [{ code: 'MTD_ADMIN', isSystemAdmin: true }] as const;

  it('recognizes only an MTD role assignment with approved metadata', () => {
    expect(isAllowAllAdministrator('MTD', admin)).toBe(true);
    expect(isAllowAllAdministrator('MEDICARTE', admin)).toBe(false);
    expect(isAllowAllAdministrator('MTD', [{ code: 'MTD_ADMIN', isSystemAdmin: false }])).toBe(
      false,
    );
  });

  it('adds system-allowed permissions without replacing explicit grants', () => {
    const permissions = effectivePermissionCodes({
      organizationCode: 'MTD',
      roles: admin,
      grantedPermissionCodes: ['custom.legacy.consumer'],
    });
    expect(permissions).toContain('custom.legacy.consumer');
    expect(permissions).toContain('users.manage');
    expect(isPermissionGrantedByAllowAll('MTD', admin, 'users.manage')).toBe(true);
  });

  it('does not elevate non-admin roles', () => {
    const permissions = effectivePermissionCodes({
      organizationCode: 'MTD',
      roles: [{ code: 'MTD_OPERATOR', isSystemAdmin: false }],
      grantedPermissionCodes: [],
    });
    expect(permissions).toEqual([]);
    expect(
      isPermissionGrantedByAllowAll(
        'MTD',
        [{ code: 'MTD_OPERATOR', isSystemAdmin: false }],
        'users.manage',
      ),
    ).toBe(false);
  });
});
