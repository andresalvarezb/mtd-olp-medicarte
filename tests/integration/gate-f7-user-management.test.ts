import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';

const database = new Client({ connectionString: databaseUrl });

let adminToken: string;
let unknownSubject: string;
const unknownUsername = `f7-unknown-${randomUUID().slice(0, 8)}`;
const unknownPassword = `F7-Unknown-${randomUUID().slice(0, 8)}`;

async function keycloakAdminToken(): Promise<string> {
  const response = await fetch(
    `${keycloakUrl}/realms/authorization/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'authorization-admin',
        client_secret: 'local-dev-admin-secret',
      }),
    },
  );
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token) throw new Error(`Keycloak admin token failed: ${response.status}`);
  return result.access_token;
}

/** Crea un usuario efímero en Keycloak y devuelve su id (subject). */
async function createKeycloakUser(username: string, password: string): Promise<string> {
  const admin = await keycloakAdminToken();
  const response = await fetch(`${keycloakUrl}/admin/realms/authorization/users`, {
    method: 'POST',
    headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.test`,
      firstName: 'F7',
      lastName: 'Test',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: password, temporary: false }],
    }),
  });
  expect(response.status).toBe(201);
  const search = await fetch(
    `${keycloakUrl}/admin/realms/authorization/users?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { authorization: `Bearer ${admin}` } },
  );
  const users = (await search.json()) as Array<{ id: string }>;
  const id = users[0]?.id;
  if (!id) throw new Error(`keycloak user ${username} not found`);
  return id;
}

/** Elimina residuos de ejecuciones previas (Keycloak + BD) por prefijo f7-. */
async function cleanupF7Users(): Promise<void> {
  const admin = await keycloakAdminToken();
  const search = await fetch(
    `${keycloakUrl}/admin/realms/authorization/users?search=f7-&max=100`,
    { headers: { authorization: `Bearer ${admin}` } },
  );
  const users = (await search.json()) as Array<{ id: string; username: string }>;
  for (const user of users.filter((entry) => entry.username.startsWith('f7-'))) {
    await fetch(`${keycloakUrl}/admin/realms/authorization/users/${user.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin}` },
    });
  }
  await database.query(`delete from pending_user_requests where email like 'f7-%@example.test'`);
  await database.query(
    `delete from user_organization_roles where user_id in (select id from users where email like 'f7-%@example.test')`,
  );
  await database.query(`delete from users where email like 'f7-%@example.test'`);
}

interface LoginResult {
  ok: boolean;
  status: number;
  error?: string;
  token?: string;
}

async function login(username: string, password: string): Promise<LoginResult> {
  const response = await fetch(
    `${keycloakUrl}/realms/authorization/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'authorization-web',
        username,
        password,
      }),
    },
  );
  const payload = (await response.json()) as { access_token?: string; error?: string };
  return {
    ok: response.ok,
    status: response.status,
    error: payload.error,
    token: payload.access_token,
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-organization-id': mtdOrganizationId,
    'content-type': 'application/json',
  };
}

interface UserPayload {
  id: string;
  email: string;
  displayName: string;
  active: boolean;
  assignments: Array<{
    organizationId: string;
    organizationCode: string;
    roleCode: string;
    active: boolean;
  }>;
}

beforeAll(async () => {
  await database.connect();
  // Estado limpio y re-ejecutable para el flujo de solicitudes pendientes.
  await cleanupF7Users();
  const result = await login('foundation-admin', 'foundation-admin');
  if (!result.token) throw new Error('foundation-admin login failed');
  adminToken = result.token;
  // Usuario que existe solo en Keycloak: dispara la solicitud pendiente al llamar /me.
  unknownSubject = await createKeycloakUser(unknownUsername, unknownPassword);
});

afterAll(async () => {
  await cleanupF7Users();
  await database.end();
});

describe('Gate F7 — Gestión de usuarios', () => {
  const suffix = randomUUID().slice(0, 8);
  const email = `f7-user-${suffix}@example.test`;
  const password = `F7-Temporary-${suffix}`;
  let userId: string;

  it('solo permite asignar MTD_AUDITOR dentro de MTD', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        email: `f7-invalid-auditor-${suffix}@example.test`,
        displayName: 'F7 Invalid Auditor',
        password,
        organizationId: olpOrganizationId,
        roleCode: 'MTD_AUDITOR',
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'ROLE_ORGANIZATION_MISMATCH',
    });
  });

  it('requires users.manage permission', async () => {
    const result = await login('olp-operator', 'olp-operator');
    if (!result.token) throw new Error('olp-operator login failed');
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      headers: {
        authorization: `Bearer ${result.token}`,
        'x-organization-id': olpOrganizationId,
      },
    });
    expect(response.status).toBe(403);
  });

  it('creates a Keycloak + local user in one operation', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        email,
        displayName: 'F7 Test Operator',
        password,
        organizationId: olpOrganizationId,
        roleCode: 'OLP_OPERATOR',
      }),
    });
    expect(response.status).toBe(201);
    const payload = (await response.json()) as UserPayload;
    userId = payload.id;
    expect(payload.email).toBe(email);
    expect(payload.active).toBe(true);
    const assignment = payload.assignments.find((entry) => entry.active);
    expect(assignment?.organizationCode).toBe('OLP');
    expect(assignment?.roleCode).toBe('OLP_OPERATOR');
  });

  it('lets the new user authenticate and resolve its profile', async () => {
    const session = await login(email, password);
    expect(session.ok).toBe(true);
    if (!session.token) throw new Error('new user login failed');
    const response = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(response.status).toBe(200);
    const profile = (await response.json()) as {
      email: string;
      organizations: Array<{ code: string; roles: string[] }>;
    };
    expect(profile.email).toBe(email);
    expect(profile.organizations[0]?.code).toBe('OLP');
    expect(profile.organizations[0]?.roles).toContain('OLP_OPERATOR');
  });

  it('adds a second organization assignment', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users/${userId}/assignments`, {
      method: 'PUT',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        organizationId: mtdOrganizationId,
        roleCode: 'READ_ONLY',
      }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as UserPayload;
    const active = payload.assignments.filter((entry) => entry.active);
    expect(active).toHaveLength(2);
  });

  it('deactivates the user and rejects its login', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users/${userId}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ active: false }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as UserPayload;
    expect(payload.active).toBe(false);
    const session = await login(email, password);
    expect(session.ok).toBe(false);
  });

  it('reactivates the user and revokes one assignment', async () => {
    const reactivate = await fetch(`${apiUrl}/api/v1/users/${userId}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ active: true }),
    });
    expect(reactivate.status).toBe(200);
    const session = await login(email, password);
    expect(session.ok).toBe(true);
    const revoke = await fetch(
      `${apiUrl}/api/v1/users/${userId}/assignments/${olpOrganizationId}`,
      { method: 'DELETE', headers: authHeaders(adminToken) },
    );
    expect(revoke.status).toBe(200);
    const payload = (await revoke.json()) as UserPayload;
    const active = payload.assignments.filter((entry) => entry.active);
    expect(active.map((entry) => entry.organizationCode)).toEqual(['MTD']);
  });

  it('records a pending request when a Keycloak user without local account calls /me', async () => {
    const result = await login(unknownUsername, unknownPassword);
    if (!result.token) throw new Error('keycloak-only user login failed');
    const me = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${result.token}` },
    });
    expect(me.status).toBe(401);
    const pending = await fetch(`${apiUrl}/api/v1/users/pending-requests`, {
      headers: authHeaders(adminToken),
    });
    expect(pending.status).toBe(200);
    const payload = (await pending.json()) as { items: Array<{ subject: string; email: string }> };
    const request = payload.items.find((entry) => entry.subject === unknownSubject);
    expect(request).toBeDefined();
  });

  it('approves the pending request and grants access', async () => {
    const pending = await fetch(`${apiUrl}/api/v1/users/pending-requests`, {
      headers: authHeaders(adminToken),
    });
    const payload = (await pending.json()) as {
      items: Array<{ id: string; subject: string; email: string }>;
    };
    const request = payload.items.find((entry) => entry.subject === unknownSubject);
    if (!request) throw new Error('pending request missing');
    const approve = await fetch(`${apiUrl}/api/v1/users/pending-requests/${request.id}/approve`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        organizationId: olpOrganizationId,
        roleCode: 'READ_ONLY',
      }),
    });
    expect(approve.status).toBe(200);
    const session = await login(unknownUsername, unknownPassword);
    if (!session.token) throw new Error('keycloak-only user login failed after approval');
    const me = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    expect(me.status).toBe(200);
    const profile = (await me.json()) as {
      organizations: Array<{ code: string; permissions: string[] }>;
    };
    expect(profile.organizations[0]?.code).toBe('OLP');
  });

  it('prevents self deactivation', async () => {
    const list = await fetch(`${apiUrl}/api/v1/users`, { headers: authHeaders(adminToken) });
    const payload = (await list.json()) as { items: Array<{ id: string; email: string }> };
    const self = payload.items.find((entry) => entry.email === 'admin@example.test');
    if (!self) throw new Error('foundation-admin local user missing');
    const response = await fetch(`${apiUrl}/api/v1/users/${self.id}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ active: false }),
    });
    expect(response.status).toBe(400);
  });
});
