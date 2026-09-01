import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureUser, login, loginAttempt } from './helpers/auth';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = ORGANIZATION_IDS.MTD;
const olpOrganizationId = ORGANIZATION_IDS.OLP;

const database = new Client({ connectionString: databaseUrl });

let adminToken: string;

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'x-organization-id': mtdOrganizationId,
    'content-type': 'application/json',
  };
}

interface UserPayload {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  passwordConfigured: boolean;
  mustChangePassword: boolean;
  assignments: Array<{
    organizationId: string;
    organizationCode: string;
    roleCode: string;
    active: boolean;
  }>;
}

/** Elimina residuos de ejecuciones previas (solo BD: ya no hay proveedor externo). */
async function cleanupF7Users(): Promise<void> {
  await database.query(
    `delete from user_organization_roles where user_id in (select id from users where username like 'f7-%')`,
  );
  await database.query(
    `delete from notification_recipients where user_id in (select id from users where username like 'f7-%')`,
  );
  await database.query(`delete from users where username like 'f7-%'`);
}

beforeAll(async () => {
  await database.connect();
  await cleanupF7Users();
  adminToken = await adminLogin();
});

afterAll(async () => {
  await cleanupF7Users();
  await database.end();
});

describe('Gate F7 — Gestión local de usuarios', () => {
  const suffix = randomUUID().slice(0, 8);
  const username = `f7-user-${suffix}`;
  const initialPassword = `F7-Inicial-${suffix}-pass`;
  const changedPassword = `F7-Cambiada-${suffix}-pass`;
  const resetPassword = `F7-Reset-${suffix}-pass`;
  let userId: string;
  let currentPassword = initialPassword;

  it('exige permiso users.manage', async () => {
    const olpToken = await ensureUser({
      adminToken,
      username: 'olp-operator',
      displayName: 'OLP Operator',
      password: 'olp-operator',
      organizationId: olpOrganizationId,
      roleCode: 'OLP_OPERATOR',
    });
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    expect(response.status).toBe(403);
  });

  it('crea el usuario exclusivamente en PostgreSQL con hash argon2id', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username,
        displayName: 'F7 Test Operator',
        password: initialPassword,
        organizationId: olpOrganizationId,
        roleCode: 'OLP_OPERATOR',
      }),
    });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toMatch(/argon2|password_hash|passwordHash/);
    const payload = JSON.parse(text) as UserPayload;
    userId = payload.id;
    expect(payload.username).toBe(username);
    expect(payload.active).toBe(true);
    expect(payload.passwordConfigured).toBe(true);
    const assignment = payload.assignments.find((entry) => entry.active);
    expect(assignment?.organizationCode).toBe('OLP');
    expect(assignment?.roleCode).toBe('OLP_OPERATOR');

    const stored = await database.query<{ hash: string }>(
      `select password_hash as hash from users where id = $1`,
      [userId],
    );
    expect(stored.rows[0]?.hash.startsWith('$argon2id$')).toBe(true);
  });

  it('rechaza usernames duplicados sin distinguir mayúsculas', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: username.toUpperCase(),
        displayName: 'F7 Duplicado',
        password: initialPassword,
        organizationId: olpOrganizationId,
        roleCode: 'READ_ONLY',
      }),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('USERNAME_TAKEN');
  });

  it('rechaza contraseñas cortas (política mínima de longitud)', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: `f7-short-${suffix}`,
        displayName: 'F7 Corta',
        password: 'corta123',
        organizationId: olpOrganizationId,
        roleCode: 'READ_ONLY',
      }),
    });
    expect(response.status).toBe(400);
  });

  it('el nuevo usuario autentica y resuelve su perfil local', async () => {
    const bearer = await login(username, initialPassword);
    const response = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(response.status).toBe(200);
    const profile = (await response.json()) as {
      username: string;
      mustChangePassword: boolean;
      organizations: Array<{ code: string; roles: string[] }>;
    };
    expect(profile.username).toBe(username);
    expect(profile.mustChangePassword).toBe(false);
    expect(profile.organizations[0]?.code).toBe('OLP');
    expect(profile.organizations[0]?.roles).toContain('OLP_OPERATOR');
  });

  it('agrega una segunda asignación organizacional', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users/${userId}/assignments`, {
      method: 'PUT',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ organizationId: mtdOrganizationId, roleCode: 'READ_ONLY' }),
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as UserPayload;
    expect(payload.assignments.filter((entry) => entry.active)).toHaveLength(2);
  });

  it('permite al usuario cambiar su contraseña y rechaza la actual incorrecta', async () => {
    const bearer = await login(username, currentPassword);
    const wrongCurrent = await fetch(`${apiUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'no-es-la-actual-1234', newPassword: changedPassword }),
    });
    expect(wrongCurrent.status).toBe(401);

    const changed = await fetch(`${apiUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword: changedPassword }),
    });
    expect(changed.status).toBe(204);

    const oldAttempt = await loginAttempt(username, currentPassword);
    expect(oldAttempt.ok).toBe(false);
    const newAttempt = await loginAttempt(username, changedPassword);
    expect(newAttempt.ok).toBe(true);
    currentPassword = changedPassword;
  });

  it('el administrador restablece la contraseña y fuerza el cambio', async () => {
    const response = await fetch(`${apiUrl}/api/v1/users/${userId}/reset-password`, {
      method: 'POST',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ password: resetPassword, mustChangePassword: true }),
    });
    expect(response.status).toBe(200);

    const oldAttempt = await loginAttempt(username, currentPassword);
    expect(oldAttempt.ok).toBe(false);
    const session = await login(username, resetPassword);
    const me = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${session}` },
    });
    const profile = (await me.json()) as { mustChangePassword: boolean };
    expect(profile.mustChangePassword).toBe(true);
    currentPassword = resetPassword;
  });

  it('desactiva al usuario y su acceso queda cortado de inmediato', async () => {
    const bearer = await login(username, currentPassword);
    const response = await fetch(`${apiUrl}/api/v1/users/${userId}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ active: false }),
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as UserPayload).active).toBe(false);

    const attempt = await loginAttempt(username, currentPassword);
    expect(attempt.ok).toBe(false);
    const me = await fetch(`${apiUrl}/api/v1/me`, { headers: { authorization: `Bearer ${bearer}` } });
    expect(me.status).toBe(401);
  });

  it('reactiva al usuario y revoca una asignación', async () => {
    const reactivate = await fetch(`${apiUrl}/api/v1/users/${userId}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ active: true }),
    });
    expect(reactivate.status).toBe(200);
    expect((await loginAttempt(username, currentPassword)).ok).toBe(true);

    const revoke = await fetch(`${apiUrl}/api/v1/users/${userId}/assignments/${olpOrganizationId}`, {
      method: 'DELETE',
      headers: authHeaders(adminToken),
    });
    expect(revoke.status).toBe(200);
    const payload = (await revoke.json()) as UserPayload;
    expect(payload.assignments.filter((entry) => entry.active).map((entry) => entry.organizationCode)).toEqual(
      ['MTD'],
    );
  });

  it('elimina el flujo pendiente heredado de Keycloak', async () => {
    const pending = await fetch(`${apiUrl}/api/v1/users/pending-requests`, {
      headers: authHeaders(adminToken),
    });
    // La ruta ya no existe: AuthGuard valida y Nest devuelve 404 de ruta.
    expect([401, 404]).toContain(pending.status);
  });

  it('bloquea auto-desactivación y la retirada del último administrador', async () => {
    const list = await fetch(`${apiUrl}/api/v1/users`, { headers: authHeaders(adminToken) });
    const { items } = (await list.json()) as { items: UserPayload[] };
    const self = items.find((entry) => entry.username === 'foundation-admin');
    if (!self) throw new Error('foundation-admin local user missing');

    const selfDeactivate = await fetch(`${apiUrl}/api/v1/users/${self.id}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ active: false }),
    });
    expect(selfDeactivate.status).toBe(400);
    expect(((await selfDeactivate.json()) as { code: string }).code).toBe(
      'SELF_DEACTIVATION_FORBIDDEN',
    );

    const revokeLast = await fetch(
      `${apiUrl}/api/v1/users/${self.id}/assignments/${mtdOrganizationId}`,
      { method: 'DELETE', headers: authHeaders(adminToken) },
    );
    expect(revokeLast.status).toBe(400);
    expect(((await revokeLast.json()) as { code: string }).code).toBe('LAST_ADMIN_PROTECTED');
  });

  it('con un segundo administrador vigente sí puede retirarse el rol', async () => {
    const secondAdminToken = await ensureUser({
      adminToken,
      username: `f7-second-admin-${suffix}`,
      displayName: 'F7 Second Admin',
      password: `F7-Second-Admin-${suffix}-pass`,
      organizationId: mtdOrganizationId,
      roleCode: 'MTD_ADMIN',
    });
    const list = await fetch(`${apiUrl}/api/v1/users`, { headers: authHeaders(adminToken) });
    const { items } = (await list.json()) as { items: UserPayload[]; };
    const self = items.find((entry) => entry.username === 'foundation-admin');
    if (!self) throw new Error('foundation-admin local user missing');

    const revoke = await fetch(
      `${apiUrl}/api/v1/users/${self.id}/assignments/${mtdOrganizationId}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${secondAdminToken}`,
          'x-organization-id': mtdOrganizationId,
          'content-type': 'application/json',
        },
      },
    );
    expect(revoke.status).toBe(200);

    // Restaura el rol del administrador de bootstrap para dejar el sistema operativo.
    const restore = await fetch(`${apiUrl}/api/v1/users/${self.id}/assignments`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${secondAdminToken}`,
        'x-organization-id': mtdOrganizationId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ organizationId: mtdOrganizationId, roleCode: 'MTD_ADMIN' }),
    });
    expect(restore.status).toBe(200);
    expect((await loginAttempt('foundation-admin', 'foundation-admin')).ok).toBe(true);
  });
});
