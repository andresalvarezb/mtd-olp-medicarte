import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_PERMISSION_REGISTRY,
  ACCESS_PERMISSION_LIFECYCLES,
  ACCESS_RETIRED_PERMISSION_CODES,
  ACCESS_MODULE_REGISTRY,
  isSystemAllowedPermission,
  validateAccessRegistry,
} from '../../packages/contracts/src';
import {
  ORGANIZATION_ROLE_MATRIX,
  PREDEFINED_ROLE_CODES,
  PROTECTED_ROLE_CODES,
  effectivePermissionCodes,
  isAllowAllAdministrator,
  isPermissionAllowedForActor,
  isRoleAllowedForOrganization,
} from '../../packages/domain/src';
import { isPointScopeGlobalActor, requiresPointGrant } from '../../packages/domain/src';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const database = new Client({ connectionString: databaseUrl });
const permissionCodes = ACCESS_PERMISSION_REGISTRY.map((permission) => permission.permissionCode);

describe('Gate ESP-020 WAVE 1 — Foundations / Security Model', () => {
  beforeAll(async () => {
    await database.connect();
  });

  afterAll(async () => {
    await database.end();
  });

  it('1. registry compiles without duplicate module/action/route definitions', () => {
    expect(() => validateAccessRegistry()).not.toThrow();
    expect(new Set(ACCESS_MODULE_REGISTRY.map((module) => module.route)).size).toBe(
      ACCESS_MODULE_REGISTRY.length,
    );
  });

  it('2. every current database permission has a registry mapping', async () => {
    const result = await database.query<{ code: string }>(
      'select code from permissions order by code',
    );
    expect(result.rows.map((row) => row.code).sort()).toEqual([...permissionCodes].sort());
  });

  it('3. every current mapping has an explicit lifecycle', () => {
    expect(
      ACCESS_PERMISSION_REGISTRY.every((permission) =>
        ACCESS_PERMISSION_LIFECYCLES.includes(permission.lifecycle),
      ),
    ).toBe(true);
    expect(ACCESS_RETIRED_PERMISSION_CODES).toHaveLength(6);
  });

  it('4. MTD_ADMIN has the approved protected role metadata', async () => {
    const result = await database.query<{
      is_system_admin: boolean;
      is_system_managed: boolean;
    }>(
      `select is_system_admin, is_system_managed
       from roles
       where code = 'MTD_ADMIN'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ is_system_admin: true, is_system_managed: true });
    expect(PROTECTED_ROLE_CODES).toContain('MTD_ADMIN');
  });

  it('5. ALLOW_ALL includes a newly registered system-allowed capability', () => {
    const roles = [{ code: 'MTD_ADMIN', isSystemAdmin: true }] as const;
    expect(isAllowAllAdministrator('MTD', roles)).toBe(true);
    expect(isSystemAllowedPermission('reconciliation_operations.manage')).toBe(true);
    expect(
      effectivePermissionCodes({
        organizationCode: 'MTD',
        roles,
        grantedPermissionCodes: [],
      }),
    ).toContain('reconciliation_operations.manage');
  });

  it('6. ALLOW_ALL is not an artificial role_permissions list and preserves global scope', () => {
    const roles = [{ code: 'MTD_ADMIN', isSystemAdmin: true }] as const;
    const permissions = effectivePermissionCodes({
      organizationCode: 'MTD',
      roles,
      grantedPermissionCodes: [],
    });
    expect(permissions.length).toBeGreaterThan(1);
    expect(isPointScopeGlobalActor('MTD', ['MTD_ADMIN'])).toBe(true);
  });

  it('7. only predefined and protected roles are exposed to the foundation policy', () => {
    expect(PREDEFINED_ROLE_CODES).toContain('MTD_ADMIN');
    expect(PREDEFINED_ROLE_CODES).not.toContain('CUSTOM_ROLE' as never);
    expect(PROTECTED_ROLE_CODES).toEqual(['MTD_ADMIN']);
  });

  it('8. valid organization-role assignments pass and invalid assignments fail', () => {
    expect(isRoleAllowedForOrganization('MTD', 'MTD_ADMIN')).toBe(true);
    expect(isRoleAllowedForOrganization('MEDICARTE', 'MEDICARTE_OPERATOR')).toBe(true);
    expect(isRoleAllowedForOrganization('MEDICARTE', 'MTD_ADMIN')).toBe(false);
    expect(isRoleAllowedForOrganization('OLP', 'MEDICARTE_OPERATOR')).toBe(false);
    expect(ORGANIZATION_ROLE_MATRIX.COMPENSAR).toContain('READ_ONLY');
  });

  it('9. actor-boundary negatives cannot escalate privileges', () => {
    expect(isPermissionAllowedForActor('OLP', 'OLP_OPERATOR', 'inventory.read')).toBe(false);
    expect(
      isPermissionAllowedForActor('MTD', 'MTD_OPERATOR', 'purchase_orders.review_supplier'),
    ).toBe(false);
    expect(
      isPermissionAllowedForActor('OLP', 'OLP_OPERATOR', 'purchase_orders.review_supplier'),
    ).toBe(true);
  });

  it('10. provenance is additive, constrained, and authorization-neutral', async () => {
    const result = await database.query<{ provenance: string }>(
      'select distinct provenance from users order by provenance',
    );
    const allowed = [
      'SYSTEM_BOOTSTRAP',
      'TEST_FIXTURE',
      'MANUAL_ADMIN_CREATED',
      'MIGRATED_LEGACY',
      'UNKNOWN',
    ];
    expect(result.rows.every((row) => allowed.includes(row.provenance))).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('11. ESP-015 semantics remain global MTD, explicit MEDICARTE, and no OLP/COMPENSAR grants', () => {
    expect(isPointScopeGlobalActor('MTD', ['MTD_ADMIN'])).toBe(true);
    expect(requiresPointGrant('MEDICARTE', ['MEDICARTE_OPERATOR'])).toBe(true);
    expect(requiresPointGrant('OLP', ['OLP_OPERATOR'])).toBe(false);
    expect(requiresPointGrant('COMPENSAR', ['COMPENSAR_VIEWER'])).toBe(false);
  });
});
