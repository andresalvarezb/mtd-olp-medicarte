import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureUser } from './helpers/auth';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const database = new Client({ connectionString: databaseUrl });
const mtdOrganizationId = ORGANIZATION_IDS.MTD;
const olpOrganizationId = ORGANIZATION_IDS.OLP;

let adminToken: string;
let createdRoleCode: string | null = null;
let createdUserId: string | null = null;

function authHeaders(token: string, organizationId = mtdOrganizationId): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-organization-id': organizationId,
    'content-type': 'application/json',
  };
}

type RoleAccessPayload = {
  role: { code: string; isProtected: boolean };
  fingerprint: string;
  modules: Array<{
    actions: Array<{
      permissionCode: string;
      enabled: boolean;
      editable: boolean;
    }>;
  }>;
};

describe('Gate ESP-020 — Role management API', () => {
  beforeAll(async () => {
    await database.connect();
    adminToken = await adminLogin();
  });

  afterAll(async () => {
    if (createdUserId) {
      await database.query('begin');
      await database.query(`delete from user_organization_roles where user_id = $1`, [
        createdUserId,
      ]);
      await database.query(`delete from users where id = $1`, [createdUserId]);
      await database.query('commit');
    }
    if (createdRoleCode) {
      await database.query('begin');
      await database.query(
        `delete from role_permissions where role_id = (select id from roles where code = $1)`,
        [createdRoleCode],
      );
      await database.query(
        `delete from role_organization_scopes where role_id = (select id from roles where code = $1)`,
        [createdRoleCode],
      );
      await database.query(`delete from roles where code = $1`, [createdRoleCode]);
      await database.query('commit');
    }
    await database.end();
  });

  it('lists predefined roles with usage metadata', async () => {
    const response = await fetch(`${apiUrl}/api/v1/roles`, {
      headers: authHeaders(adminToken),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: Array<{ code: string; userCount: number; permissionCount: number }>;
    };
    expect(payload.items.map((role) => role.code)).toContain('MTD_ADMIN');
    expect(payload.items.every((role) => role.userCount >= 0)).toBe(true);
  });

  it('returns canonical module access and an optimistic-concurrency fingerprint', async () => {
    const response = await fetch(`${apiUrl}/api/v1/roles/MTD_OPERATOR/access`, {
      headers: authHeaders(adminToken),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as RoleAccessPayload;
    expect(payload.role.code).toBe('MTD_OPERATOR');
    expect(payload.role.isProtected).toBe(false);
    expect(payload.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.modules.length).toBeGreaterThan(0);
    expect(
      payload.modules.some((module) =>
        module.actions.some((action) => action.permissionCode === 'planning_periods.read'),
      ),
    ).toBe(true);
  });

  it('creates assignments only for the selected organizations within the role scope', async () => {
    const username = `esp020-role-scope-${randomUUID().slice(0, 8)}`;
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username,
        displayName: 'ESP-020 Role Scope',
        password: 'RoleScope-123456',
        organizationIds: [mtdOrganizationId, olpOrganizationId],
        roleCode: 'READ_ONLY',
      }),
    });
    expect(response.status).toBe(201);
    const user = (await response.json()) as {
      id: string;
      assignments: Array<{ organizationCode: string; roleCode: string; active: boolean }>;
    };
    createdUserId = user.id;
    expect(user.assignments.filter((assignment) => assignment.active)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ organizationCode: 'MTD', roleCode: 'READ_ONLY' }),
        expect.objectContaining({ organizationCode: 'OLP', roleCode: 'READ_ONLY' }),
      ]),
    );
    expect(user.assignments.filter((assignment) => assignment.active)).toHaveLength(2);
  });

  it('exposes the canonical module registry only to administrators', async () => {
    const response = await fetch(`${apiUrl}/api/v1/modules`, {
      headers: authHeaders(adminToken),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      items: Array<{ code: string; actions: Array<{ permissionCode: string }> }>;
    };
    expect(payload.items.length).toBeGreaterThan(0);
    expect(
      payload.items.some((module) =>
        module.actions.some((action) => action.permissionCode === 'users.manage'),
      ),
    ).toBe(true);
  });

  it('does not permit editing the protected administrator role', async () => {
    const response = await fetch(`${apiUrl}/api/v1/roles/MTD_ADMIN/access`, {
      headers: authHeaders(adminToken),
    });
    expect(response.status).toBe(200);
    const access = (await response.json()) as RoleAccessPayload;
    const update = await fetch(`${apiUrl}/api/v1/roles/MTD_ADMIN/access`, {
      method: 'PUT',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        expectedFingerprint: access.fingerprint,
        permissionCodes: [],
      }),
    });
    expect(update.status).toBe(400);
    expect(((await update.json()) as { code: string }).code).toBe('ROLE_PROTECTED');
  });

  it('creates custom roles with organization scopes and configurable actions', async () => {
    const name = `ESP-020 Custom ${randomUUID().slice(0, 8)}`;
    const create = await fetch(`${apiUrl}/api/v1/roles`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ name, organizationCodes: ['OLP'] }),
    });
    expect(create.status).toBe(201);
    const role = (await create.json()) as {
      code: string;
      name: string;
      isCustom: boolean;
      active: boolean;
      allowedOrganizationCodes: string[];
    };
    createdRoleCode = role.code;
    expect(role.name).toBe(name);
    expect(role.isCustom).toBe(true);
    expect(role.active).toBe(true);
    expect(role.allowedOrganizationCodes).toEqual(['OLP']);

    const accessResponse = await fetch(`${apiUrl}/api/v1/roles/${role.code}/access`, {
      headers: authHeaders(adminToken),
    });
    expect(accessResponse.status).toBe(200);
    const access = (await accessResponse.json()) as RoleAccessPayload;
    const supplierDelivery = access.modules
      .flatMap((module) => module.actions)
      .find((action) => action.permissionCode === 'supplier_deliveries.read');
    const mtdOnly = access.modules
      .flatMap((module) => module.actions)
      .find((action) => action.permissionCode === 'planning_periods.read');
    expect(supplierDelivery?.editable).toBe(true);
    expect(mtdOnly?.editable).toBe(false);
  });

  it('deactivates custom roles without affecting predefined roles', async () => {
    if (!createdRoleCode) throw new Error('Custom role was not created');
    const response = await fetch(`${apiUrl}/api/v1/roles/${createdRoleCode}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ active: false }),
    });
    expect(response.status).toBe(200);
    const role = (await response.json()) as { active: boolean; isCustom: boolean };
    expect(role).toMatchObject({ active: false, isCustom: true });

    const accessResponse = await fetch(`${apiUrl}/api/v1/roles/${createdRoleCode}/access`, {
      headers: authHeaders(adminToken),
    });
    expect(accessResponse.status).toBe(200);
    const access = (await accessResponse.json()) as RoleAccessPayload;
    expect(
      access.modules.flatMap((module) => module.actions).every((action) => !action.editable),
    ).toBe(true);
  });

  it('deletes an inactive custom role without deleting predefined roles', async () => {
    if (!createdRoleCode) throw new Error('Custom role was not created');
    const deletedCode = createdRoleCode;
    const response = await fetch(`${apiUrl}/api/v1/roles/${deletedCode}`, {
      method: 'DELETE',
      headers: authHeaders(adminToken),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    createdRoleCode = null;

    const roles = await fetch(`${apiUrl}/api/v1/roles`, {
      headers: authHeaders(adminToken),
    });
    expect(roles.status).toBe(200);
    expect(((await roles.json()) as { items: Array<{ code: string }> }).items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: deletedCode })]),
    );
  });

  it('rejects stale role access writes', async () => {
    const response = await fetch(`${apiUrl}/api/v1/roles/MTD_OPERATOR/access`, {
      headers: authHeaders(adminToken),
    });
    const access = (await response.json()) as RoleAccessPayload;
    const update = await fetch(`${apiUrl}/api/v1/roles/MTD_OPERATOR/access`, {
      method: 'PUT',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        expectedFingerprint: '0'.repeat(64),
        permissionCodes: access.modules
          .flatMap((module) => module.actions)
          .filter((action) => action.editable && action.enabled)
          .map((action) => action.permissionCode),
      }),
    });
    expect(update.status).toBe(409);
    expect(((await update.json()) as { code: string }).code).toBe('ROLE_ACCESS_CONFLICT');
  });

  it('updates configurable capabilities and records the role audit event', async () => {
    const response = await fetch(`${apiUrl}/api/v1/roles/MTD_OPERATOR/access`, {
      headers: authHeaders(adminToken),
    });
    const access = (await response.json()) as RoleAccessPayload;
    const before = await database.query<{ count: string }>(
      `select count(*)::text as count
         from audit_events
        where action = 'ROLE_ACCESS_CHANGED' and resource_id = 'MTD_OPERATOR'`,
    );
    const update = await fetch(`${apiUrl}/api/v1/roles/MTD_OPERATOR/access`, {
      method: 'PUT',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        expectedFingerprint: access.fingerprint,
        permissionCodes: access.modules
          .flatMap((module) => module.actions)
          .filter((action) => action.editable && action.enabled)
          .map((action) => action.permissionCode),
      }),
    });
    expect(update.status).toBe(200);
    expect(((await update.json()) as RoleAccessPayload).fingerprint).toBe(access.fingerprint);
    const after = await database.query<{ count: string }>(
      `select count(*)::text as count
         from audit_events
        where action = 'ROLE_ACCESS_CHANGED' and resource_id = 'MTD_OPERATOR'`,
    );
    expect(Number(after.rows[0]?.count)).toBe(Number(before.rows[0]?.count) + 1);
  });

  it('requires users.manage for role administration', async () => {
    const olpToken = await ensureUser({
      adminToken,
      username: 'esp020-role-operator',
      displayName: 'ESP-020 Role Operator',
      password: 'ESP020-role-operator',
      organizationId: olpOrganizationId,
      roleCode: 'OLP_OPERATOR',
    });
    const response = await fetch(`${apiUrl}/api/v1/roles`, {
      headers: authHeaders(olpToken, olpOrganizationId),
    });
    expect(response.status).toBe(403);
  });
});
