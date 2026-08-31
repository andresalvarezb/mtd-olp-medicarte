import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const organizationId = '10000000-0000-4000-8000-000000000001';
const database = new Client({ connectionString: databaseUrl });
let token: string;
let olpToken: string;
let suspendedToken: string;
let unknownToken: string;
/** Subjects creados directamente en Keycloak; se eliminan en la limpieza final. */
const keycloakOnlySubjects: string[] = [];

async function login(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'authorization-web',
    username,
    password,
  });
  const response = await fetch(
    `${keycloakUrl}/realms/authorization/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token)
    throw new Error(`Keycloak login failed for ${username}: ${response.status}`);
  return result.access_token;
}

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
      firstName: 'F1',
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

async function deleteKeycloakUser(subject: string): Promise<void> {
  const admin = await keycloakAdminToken();
  await fetch(`${keycloakUrl}/admin/realms/authorization/users/${subject}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${admin}` },
  });
}

beforeAll(async () => {
  await database.connect();
  token = await login('foundation-admin', 'foundation-admin');
  olpToken = await login('olp-operator', 'olp-operator');

  // Usuario suspendido: existe en Keycloak y localmente, pero con active=false.
  const suffix = randomUUID().slice(0, 8);
  const suspendedEmail = `f1-suspended-${suffix}@example.test`;
  const suspendedPassword = `F1-Suspended-${suffix}`;
  const createResponse = await fetch(`${apiUrl}/api/v1/users`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: suspendedEmail,
      displayName: 'F1 Suspended User',
      password: suspendedPassword,
      organizationId,
      roleCode: 'READ_ONLY',
    }),
  });
  expect(createResponse.status).toBe(201);
  await database.query(`update users set active = false where email = $1`, [suspendedEmail]);
  suspendedToken = await login(suspendedEmail, suspendedPassword);

  // Usuario conocido por Keycloak pero sin cuenta local: /me debe rechazarlo.
  const unknownUsername = `f1-unknown-${suffix}`;
  const unknownPassword = `F1-Unknown-${suffix}`;
  keycloakOnlySubjects.push(await createKeycloakUser(unknownUsername, unknownPassword));
  unknownToken = await login(unknownUsername, unknownPassword);
});

afterAll(async () => {
  // Limpieza: los usuarios efímeros no deben quedar ni en Keycloak ni en la BD.
  const stale = await database.query<{ oidc_subject: string }>(
    `select oidc_subject from users where email like 'f1-%@example.test'`,
  );
  const subjects = [
    ...stale.rows.map((row) => row.oidc_subject),
    ...keycloakOnlySubjects,
  ];
  for (const subject of subjects) await deleteKeycloakUser(subject);
  await database.query(`delete from pending_user_requests where oidc_subject = any($1)`, [
    subjects,
  ]);
  await database.query(
    `delete from pending_user_requests where email like 'f1-%@example.test'`,
  );
  await database.query(
    `delete from user_organization_roles where user_id in (select id from users where oidc_subject = any($1))`,
    [subjects],
  );
  await database.query(`delete from users where oidc_subject = any($1)`, [subjects]);
  await database.end();
});

describe('Gate F1', () => {
  it('reports API, PostgreSQL and Redis as healthy', async () => {
    const response = await fetch(`${apiUrl}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      checks: { api: 'up', database: 'up', redis: 'up' },
    });
  });

  it('authenticates with Keycloak and resolves local organization permissions', async () => {
    const response = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const profile = (await response.json()) as {
      organizations: Array<{ id: string; permissions: string[] }>;
    };
    expect(profile.organizations).toHaveLength(2);
    const mtd = profile.organizations.find((scope) => scope.id === organizationId);
    expect(mtd?.permissions).toContain('platform.foundation.execute');
    expect(mtd?.permissions).not.toContain('application_site.assign');
    expect(mtd?.permissions).not.toContain('dispensing.register');
  });

  it('enforces local suspension, organization scope and least privilege', async () => {
    const suspended = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${suspendedToken}` },
    });
    expect(suspended.status).toBe(401);
    const unknown = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${unknownToken}` },
    });
    expect(unknown.status).toBe(401);

    const olpProfile = await fetch(`${apiUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${olpToken}` },
    });
    expect(olpProfile.status).toBe(200);
    const denied = await fetch(`${apiUrl}/api/v1/foundation/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${olpToken}`,
        'content-type': 'application/json',
        'idempotency-key': `denied-${randomUUID()}`,
        'x-organization-id': '10000000-0000-4000-8000-000000000003',
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
        'x-organization-id': '10000000-0000-4000-8000-000000000003',
      },
      body: JSON.stringify({ message: 'cross-organization denial' }),
    });
    expect(horizontal.status).toBe(403);

    const deadLetterDenied = await fetch(`${apiUrl}/api/v1/admin/dead-letter-jobs`, {
      headers: {
        authorization: `Bearer ${olpToken}`,
        'x-organization-id': '10000000-0000-4000-8000-000000000003',
      },
    });
    expect(deadLetterDenied.status).toBe(403);
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

  it('publishes OpenAPI under the versioned API', async () => {
    const response = await fetch(`${apiUrl}/api/v1/openapi.json`);
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<
        string,
        {
          get?: { parameters?: Array<{ name: string }>; responses?: Record<string, unknown> };
          post?: { responses?: Record<string, unknown> };
        }
      >;
    };
    expect(document.paths['/api/v1/me']).toBeDefined();
    expect(document.paths['/api/v1/me']?.get?.responses?.['200']).toBeDefined();
    expect(document.paths['/api/v1/foundation/events']?.post?.responses?.['202']).toBeDefined();
    expect(document.paths['/api/v1/foundation/events']?.post?.responses?.['400']).toBeDefined();
    expect(document.paths['/api/v1/foundation/events']?.post?.responses?.['403']).toBeDefined();
    expect(document.paths['/api/v1/admin/dead-letter-jobs']?.get?.parameters).toContainEqual(
      expect.objectContaining({ name: 'X-Organization-Id' }),
    );
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
    const payload = { eventId, message: 'Reconciled delivery', correlationId, idempotencyKey };
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
