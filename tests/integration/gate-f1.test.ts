import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureUser, loginAttempt } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const organizationId = ORGANIZATION_IDS.MTD;
const olpOrganizationId = ORGANIZATION_IDS.OLP;
const database = new Client({ connectionString: databaseUrl });
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

let token: string;
let olpToken: string;
/** Usuario efímero creado y luego eliminado: su token queda huérfano. */
let orphanToken: string;
let orphanId: string;

async function apiCall(
  method: string,
  path: string,
  body: unknown,
  bearer: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-organization-id': organizationId,
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Elimina usuario de prueba y sus asignaciones (auditoría append-only queda). */
async function purgeUser(userId: string): Promise<void> {
  await database.query(`delete from user_organization_roles where user_id = $1`, [userId]);
  await database.query(`delete from notification_recipients where created_by = $1`, [userId]);
  await database.query(`delete from users where id = $1`, [userId]);
}

beforeAll(async () => {
  await database.connect();
  token = await adminLogin();
  olpToken = await ensureUser({
    adminToken: token,
    username: 'olp-operator',
    displayName: 'OLP Operator',
    password: 'olp-operator',
    organizationId: olpOrganizationId,
    roleCode: 'OLP_OPERATOR',
  });

  // Cuenta activa cuyo token se emite y luego se elimina el usuario de la BD.
  const suffix = randomUUID().slice(0, 8);
  orphanToken = await ensureUser({
    adminToken: token,
    username: `f1-orphan-${suffix}`,
    displayName: 'F1 Orphan Token',
    password: `F1-Orphan-${suffix}-pw`,
    organizationId,
    roleCode: 'READ_ONLY',
  });
  const created = await database.query<{ id: string }>(`select id from users where username = $1`, [
    `f1-orphan-${suffix}`,
  ]);
  orphanId = created.rows[0]?.id as string;
});

afterAll(async () => {
  await purgeUser(orphanId);
  await database.query(
    `delete from user_organization_roles where user_id in (select id from users where username like 'f1-%')`,
  );
  await database.query(`delete from users where username like 'f1-%'`);
  await database.end();
});

describe('Gate F1 — autenticación local', () => {
  it('reports API, PostgreSQL and Redis as healthy', async () => {
    const response = await fetch(`${apiUrl}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { api: 'up', database: 'up', redis: 'up' },
    });
  });

  it('inicia sesión con usuario local y resuelve organizaciones y permisos', async () => {
    const response = await apiCall('GET', '/me', undefined, token);
    expect(response.status).toBe(200);
    const profile = (await response.json()) as {
      username: string;
      organizations: Array<{ id: string; permissions: string[] }>;
    };
    expect(profile.username).toBe('foundation-admin');
    expect(profile.organizations.length).toBeGreaterThanOrEqual(1);
    const mtd = profile.organizations.find((scope) => scope.id === organizationId);
    expect(mtd?.permissions).toContain('platform.foundation.execute');
    expect(mtd?.permissions).toContain('users.manage');
    // MTD_ADMIN NO recibe application_site.assign ni dispensing.register (0000).
    expect(mtd?.permissions).not.toContain('application_site.assign');
    expect(mtd?.permissions).not.toContain('dispensing.register');
  });

  it('rechaza contraseña incorrecta, usuario inexistente e inactivo con error genérico', async () => {
    const bad = await loginAttempt('foundation-admin', 'clave-equivocada-larga');
    expect(bad.status).toBe(401);
    expect(bad.code).toBe('INVALID_CREDENTIALS');
    expect(bad.token).toBeNull();

    const missing = await loginAttempt('no-existe-nadie-xyz', 'cualquier-cosa-larga');
    expect(missing.status).toBe(401);
    expect(missing.code).toBe('INVALID_CREDENTIALS');

    const suffix = randomUUID().slice(0, 8);
    const username = `f1-inactive-${suffix}`;
    const password = `F1-Inactive-${suffix}-pw`;
    const created = await apiCall(
      'POST',
      '/users',
      { username, displayName: 'F1 Inactive', password, organizationId, roleCode: 'READ_ONLY' },
      token,
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await database.query(`update users set active = false where id = $1`, [id]);
    const inactive = await loginAttempt(username, password);
    expect(inactive.status).toBe(401);
    expect(inactive.code).toBe('INVALID_CREDENTIALS');
    await purgeUser(id);
  });

  it('acepta el username sin distinguir mayúsculas', async () => {
    const attempt = await loginAttempt('FOUNDATION-ADMIN', 'foundation-admin');
    expect(attempt.ok).toBe(true);
  });

  it('deniega rutas y organizaciones sin permiso (RBAC)', async () => {
    const denied = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${olpToken}`,
        'content-type': 'application/json',
        'idempotency-key': `denied-${randomUUID()}`,
        'x-organization-id': olpOrganizationId,
      },
      body: JSON.stringify({ message: 'must be denied' }),
    });
    expect(denied.status).toBe(403);

    const horizontal = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': `horizontal-${randomUUID()}`,
        'x-organization-id': olpOrganizationId,
      },
      body: JSON.stringify({ message: 'cross-organization denial' }),
    });
    expect(horizontal.status).toBe(403);

    const deadLetterDenied = await fetch(`${apiUrl}/api/v1/admin/dead-letter-jobs`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    expect(deadLetterDenied.status).toBe(403);
  });

  it('invalida de inmediato un token cuyo usuario fue desactivado', async () => {
    const suffix = randomUUID().slice(0, 8);
    const username = `f1-disable-${suffix}`;
    const bearer = await ensureUser({
      adminToken: token,
      username,
      displayName: 'F1 Disable',
      password: `F1-Disable-${suffix}-pw`,
      organizationId,
      roleCode: 'READ_ONLY',
    });
    expect((await apiCall('GET', '/me', undefined, bearer)).status).toBe(200);
    const userRow = await database.query<{ id: string }>(
      `select id from users where username = $1`,
      [username],
    );
    const id = userRow.rows[0]?.id as string;
    await apiCall('PATCH', `/users/${id}`, { active: false }, token);
    const rejected = await apiCall('GET', '/me', undefined, bearer);
    expect(rejected.status).toBe(401);
    await purgeUser(id);
  });

  it('rechaza un token cuyo usuario fue eliminado tras emitirse', async () => {
    await purgeUser(orphanId);
    const rejected = await apiCall('GET', '/me', undefined, orphanToken);
    expect(rejected.status).toBe(401);
  });

  it('refleja el cambio de rol sin esperar expiración del token', async () => {
    const suffix = randomUUID().slice(0, 8);
    const username = `f1-role-${suffix}`;
    const bearer = await ensureUser({
      adminToken: token,
      username,
      displayName: 'F1 Role',
      password: `F1-Role-${suffix}-pw`,
      organizationId,
      roleCode: 'READ_ONLY',
    });
    const before = await apiCall('GET', '/me', undefined, bearer);
    const beforeProfile = (await before.json()) as {
      organizations: Array<{ permissions: string[] }>;
    };
    expect(beforeProfile.organizations[0]?.permissions).not.toContain('users.manage');

    const userRow = await database.query<{ id: string }>(
      `select id from users where username = $1`,
      [username],
    );
    const id = userRow.rows[0]?.id as string;
    await apiCall(
      'PUT',
      `/users/${id}/assignments`,
      { organizationId, roleCode: 'MTD_ADMIN' },
      token,
    );
    const after = await apiCall('GET', '/me', undefined, bearer);
    const afterProfile = (await after.json()) as {
      organizations: Array<{ id: string; permissions: string[] }>;
    };
    const mtd = afterProfile.organizations.find((scope) => scope.id === organizationId);
    expect(mtd?.permissions).toContain('users.manage');
    await purgeUser(id);
  });

  it('rechaza tokens JWT inválidos o manipulados', async () => {
    const garbage = await apiCall('GET', '/me', undefined, 'not.a.jwt');
    expect(garbage.status).toBe(401);
    const [header, payload, signature] = token.split('.');
    const tampered = [header, payload, 'A'.repeat((signature ?? '').length)].join('.');
    const bad = await apiCall('GET', '/me', undefined, tampered);
    expect(bad.status).toBe(401);
  });

  it('nunca expone hash ni credenciales en /me o en el listado de usuarios', async () => {
    const me = (await (await apiCall('GET', '/me', undefined, token)).json()) as Record<
      string,
      unknown
    >;
    expect(me).not.toHaveProperty('password_hash');
    expect(me).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(me)).not.toMatch(/\$argon2id\$/i);
    const list = (await (await apiCall('GET', '/users', undefined, token)).json()) as {
      items: Array<Record<string, unknown>>;
    };
    for (const user of list.items) {
      expect(user).not.toHaveProperty('password_hash');
      expect(user).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(user)).not.toMatch(/\$argon2id\$/);
    }
  });

  it('returns stable validation and idempotency conflict errors', async () => {
    const key = `validation-${randomUUID()}`;
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': key,
      'x-organization-id': organizationId,
    };
    const invalid = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: '' }),
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()) as { code: string }).toMatchObject({ code: 'VALIDATION_ERROR' });

    const first = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'first payload' }),
    });
    expect(first.status).toBe(202);
    const conflict = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'different payload' }),
    });
    expect(conflict.status).toBe(409);
  });

  it('processes one transactional outbox event and persists immutable audit', async () => {
    const idempotencyKey = `gate-f1-${randomUUID()}`;
    const correlationId = randomUUID();
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'x-organization-id': organizationId,
      'x-correlation-id': correlationId,
    };
    const first = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'Gate F1 end-to-end' }),
    });
    expect(first.status).toBe(202);
    const accepted = (await first.json()) as { eventId: string };
    const replay = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'Gate F1 end-to-end' }),
    });
    expect(await replay.json()).toEqual(accepted);

    const deadline = Date.now() + 15_000;
    let processed = false;
    while (Date.now() < deadline) {
      const result = await database.query<{ status: string }>(
        'select status from outbox_events where id = $1',
        [accepted.eventId],
      );
      if (result.rows[0]?.status === 'PROCESSED') {
        processed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(processed).toBe(true);
    const jobs = await database.query(
      'select job_results.id from job_results join outbox_events using (idempotency_key) where outbox_events.id = $1',
      [accepted.eventId],
    );
    expect(jobs.rowCount).toBe(1);
    const audits = await database.query('select id from audit_events where resource_id = $1', [
      accepted.eventId,
    ]);
    expect(audits.rowCount).toBe(1);
    await expect(
      database.query('delete from audit_events where resource_id = $1', [accepted.eventId]),
    ).rejects.toThrow('append-only');
  });

  it('registra LOGIN_SUCCESS y LOGIN_FAILED sin exponer la contraseña', async () => {
    await loginAttempt('foundation-admin', 'no-importa-que-falle-aqui');
    const deadline = Date.now() + 5_000;
    let found = false;
    while (Date.now() < deadline) {
      const failed = await database.query<{ count: string }>(
        `select count(*)::text as count from audit_events
          where action = 'LOGIN_FAILED' and resource_type = 'auth_session'`,
      );
      const success = await database.query<{ count: string }>(
        `select count(*)::text as count from audit_events
          where action = 'LOGIN_SUCCESS' and resource_type = 'auth_session'`,
      );
      const leaked = await database.query<{ count: string }>(
        `select count(*)::text as count from audit_events
          where (after::text ilike '%no-importa-que-falle-aqui%')
             or after::text ilike '%argon2%'`,
      );
      if (
        Number(failed.rows[0]?.count ?? 0) > 0 &&
        Number(success.rows[0]?.count ?? 0) > 0 &&
        Number(leaked.rows[0]?.count ?? 0) === 0
      ) {
        found = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(found).toBe(true);
  });

  it('publishes OpenAPI under the versioned API', async () => {
    const response = await fetch(`${apiUrl}/api/v1/openapi.json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(document.paths['/api/v1/auth/login']).toBeDefined();
    expect(document.paths['/api/v1/auth/login']?.post?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/v1/foundation/events']?.post?.responses?.['202']).toBeDefined();
    expect(document.paths['/api/v1/foundation/events']?.post?.responses?.['403']).toBeDefined();
  });

  it('protects operational metrics while keeping readiness public', async () => {
    const anonymous = await fetch(`${apiUrl}/api/v1/metrics`);
    expect(anonymous.status).toBe(401);
    const authorized = await fetch(`${apiUrl}/api/v1/metrics`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
    });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('content-type')).toContain('text/plain');
    expect(await authorized.text()).toContain('authorization_queue_jobs');
  });

  it('isolates a malformed outbox event and exposes its durable failure', async () => {
    const poisonId = randomUUID();
    await database.query(
      `insert into outbox_events (id, event_type, version, payload, correlation_id, organization_id, idempotency_key)
       values ($1, 'unsupported.event', 99, '{}', $2, $3, $4)`,
      [poisonId, randomUUID(), organizationId, `poison-${randomUUID()}`],
    );
    const deadline = Date.now() + 10_000;
    let failed = false;
    while (Date.now() < deadline) {
      const result = await database.query<{ status: string }>(
        'select status from outbox_events where id = $1',
        [poisonId],
      );
      if (result.rows[0]?.status === 'FAILED') {
        failed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(failed).toBe(true);
    const response = await fetch(`${apiUrl}/api/v1/admin/dead-letter-jobs`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as Array<{ id: string }>).toContainEqual(
      expect.objectContaining({ id: poisonId }),
    );
  });

  it('recovers a stale dispatched event after a lost Redis delivery', async () => {
    const eventId = randomUUID();
    const correlationId = randomUUID();
    const idempotencyKey = `reconcile-${randomUUID()}`;
    const payload = { eventId, message: 'Reconciled Delivery', correlationId, idempotencyKey };
    await database.query(
      `insert into outbox_events (id, event_type, version, payload, correlation_id, organization_id, idempotency_key, status, dispatched_at)
       values ($1, 'foundation.event', 1, $2, $3, $4, $5, 'DISPATCHED', now() - interval '1 minute')`,
      [eventId, payload, correlationId, organizationId, idempotencyKey],
    );
    const deadline = Date.now() + 10_000;
    let processed = false;
    while (Date.now() < deadline) {
      const result = await database.query<{ status: string }>(
        'select status from outbox_events where id = $1',
        [eventId],
      );
      if (result.rows[0]?.status === 'PROCESSED') {
        processed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(processed).toBe(true);
  });
});
