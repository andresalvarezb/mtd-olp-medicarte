import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens, ensureUser } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });
const mtdOrganizationId = ORGANIZATION_IDS.MTD;
/** Usuario efímero con SOLO planning_periods.read (READ_ONLY en MTD). */
const READ_ONLY_USERNAME = 'esp002-readonly';

let adminToken: string;
let olpToken: string;
let readOnlyToken: string;
let periodAId: string;
let periodBId: string;
let authorizationItemsBefore: number;

async function apiCall(
  method: string,
  path: string,
  body: unknown,
  token: string,
  organizationId: string | undefined = mtdOrganizationId,
): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(organizationId ? { 'x-organization-id': organizationId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function countAuditEvents(periodId: string): Promise<number> {
  const result = await database.query<{ count: number }>(
    `select count(*)::int as count from audit_events
      where resource_type = 'planning_period' and resource_id = $1`,
    [periodId],
  );
  return result.rows[0]?.count ?? 0;
}

beforeAll(async () => {
  await database.connect();
  adminToken = await adminLogin();
  ({ olpToken } = await ensureOperatorTokens());
  readOnlyToken = await ensureUser({
    adminToken,
    username: READ_ONLY_USERNAME,
    displayName: 'ESP-002 Read Only',
    password: 'esp002-readonly-pw',
    organizationId: mtdOrganizationId,
    roleCode: 'READ_ONLY',
  });

  // Limpia residuos de corridas fallidas dentro de las ventanas de prueba: la
  // constraint de exclusión impide recrear un rango ya existente.
  await database.query(
    `delete from planning_periods
      where daterange(start_date, end_date, '[]')
            && daterange('2031-03-01', '2031-06-30', '[]')`,
  );
  const items = await database.query<{ count: number }>(
    `select count(*)::int as count from authorization_items`,
  );
  authorizationItemsBefore = items.rows[0]?.count ?? 0;
});

afterAll(async () => {
  await database.query(`delete from planning_periods where id in ($1, $2)`, [periodAId, periodBId]);
  await database.query(
    `delete from planning_periods
      where daterange(start_date, end_date, '[]')
            && daterange('2031-06-01', '2031-06-30', '[]')`,
  );
  await database.query(
    `delete from user_organization_roles
      where user_id in (select id from users where username = $1)`,
    [READ_ONLY_USERNAME],
  );
  await database.query(`delete from users where username = $1`, [READ_ONLY_USERNAME]);
  await database.end();
});

describe('Gate ESP-002 — períodos de planificación', () => {
  it('rechaza a OLP: no tiene planning_periods.read', async () => {
    const response = await apiCall(
      'GET',
      '/planning-periods',
      undefined,
      olpToken,
      ORGANIZATION_IDS.OLP,
    );
    expect(response.status).toBe(403);
  });

  it('exige X-Organization-Id', async () => {
    const response = await fetch(`${apiUrl}/api/v1/planning-periods`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    // Consistente con el patrón de users: el header se valida antes del RBAC.
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('valida el rango de fechas', async () => {
    const response = await apiCall(
      'POST',
      '/planning-periods',
      {
        startDate: '2031-04-10',
        endDate: '2031-04-01',
        schedulingCutoffAt: '2031-04-02T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-04-03T23:59:00-05:00',
        expectedDeliveryDate: '2031-04-07',
      },
      adminToken,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PLANNING_PERIOD_INVALID_RANGE',
    );
  });

  it('valida el orden corte → límite de OC', async () => {
    const response = await apiCall(
      'POST',
      '/planning-periods',
      {
        startDate: '2031-04-14',
        endDate: '2031-04-20',
        schedulingCutoffAt: '2031-04-16T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-04-15T23:59:00-05:00',
        expectedDeliveryDate: '2031-04-21',
      },
      adminToken,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PLANNING_PERIOD_INVALID_DEADLINE_ORDER',
    );
  });

  it('valida que la entrega esperada no sea anterior al límite de OC', async () => {
    const response = await apiCall(
      'POST',
      '/planning-periods',
      {
        startDate: '2031-05-05',
        endDate: '2031-05-11',
        schedulingCutoffAt: '2031-05-06T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-05-08T23:59:00-05:00',
        expectedDeliveryDate: '2031-05-07',
      },
      adminToken,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PLANNING_PERIOD_DELIVERY_BEFORE_DEADLINE',
    );
  });

  it('crea un período válido y rechaza solapamiento, pero acepta contiguo', async () => {
    const created = await apiCall(
      'POST',
      '/planning-periods',
      {
        startDate: '2031-03-03',
        endDate: '2031-03-09',
        schedulingCutoffAt: '2031-03-04T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-03-05T23:59:00-05:00',
        expectedDeliveryDate: '2031-03-10',
      },
      adminToken,
    );
    expect(created.status).toBe(201);
    const periodA = (await created.json()) as {
      id: string;
      status: string;
      version: number;
      startDate: string;
      endDate: string;
    };
    periodAId = periodA.id;
    expect(periodA.status).toBe('OPEN');
    expect(periodA.version).toBe(1);

    const overlap = await apiCall(
      'POST',
      '/planning-periods',
      {
        startDate: '2031-03-05',
        endDate: '2031-03-12',
        schedulingCutoffAt: '2031-03-06T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-03-07T23:59:00-05:00',
        expectedDeliveryDate: '2031-03-13',
      },
      adminToken,
    );
    expect(overlap.status).toBe(409);
    expect(((await overlap.json()) as { code: string }).code).toBe('PLANNING_PERIOD_OVERLAP');

    const contiguous = await apiCall(
      'POST',
      '/planning-periods',
      {
        startDate: '2031-03-10',
        endDate: '2031-03-16',
        schedulingCutoffAt: '2031-03-11T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-03-12T23:59:00-05:00',
        expectedDeliveryDate: '2031-03-17',
      },
      adminToken,
    );
    expect(contiguous.status).toBe(201);
    periodBId = ((await contiguous.json()) as { id: string }).id;
  });

  it('lista y consulta el detalle', async () => {
    const list = await apiCall('GET', '/planning-periods?status=OPEN', undefined, adminToken);
    expect(list.status).toBe(200);
    const { items } = (await list.json()) as { items: Array<{ id: string }> };
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([periodAId, periodBId]));

    const detail = await apiCall('GET', `/planning-periods/${periodAId}`, undefined, adminToken);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { startDate: string }).startDate).toBe('2031-03-03');
  });

  it('bloquea transiciones arbitrarias y permite la secuencia explícita', async () => {
    const jump = await apiCall(
      'POST',
      `/planning-periods/${periodAId}/transition`,
      {
        to: 'PURCHASING',
        expectedVersion: 1,
      },
      adminToken,
    );
    expect(jump.status).toBe(409);
    expect(((await jump.json()) as { code: string }).code).toBe(
      'PLANNING_PERIOD_INVALID_TRANSITION',
    );

    const close = await apiCall(
      'POST',
      `/planning-periods/${periodAId}/transition`,
      {
        to: 'PLANNING_CLOSED',
        expectedVersion: 1,
      },
      adminToken,
    );
    expect(close.status).toBe(200);
    expect(((await close.json()) as { status: string }).status).toBe('PLANNING_CLOSED');
  });

  it('permite editar fechas en PLANNING_CLOSED y las congela en PURCHASING', async () => {
    const editable = await apiCall(
      'PATCH',
      `/planning-periods/${periodAId}`,
      {
        expectedVersion: 2,
        startDate: '2031-03-02',
        endDate: '2031-03-09',
      },
      adminToken,
    );
    expect(editable.status).toBe(200);
    expect(((await editable.json()) as { version: number }).version).toBe(3);

    const toPurchasing = await apiCall(
      'POST',
      `/planning-periods/${periodAId}/transition`,
      {
        to: 'PURCHASING',
        expectedVersion: 3,
      },
      adminToken,
    );
    expect(toPurchasing.status).toBe(200);

    const frozen = await apiCall(
      'PATCH',
      `/planning-periods/${periodAId}`,
      {
        expectedVersion: 4,
        endDate: '2031-03-15',
      },
      adminToken,
    );
    expect(frozen.status).toBe(409);
    expect(((await frozen.json()) as { code: string }).code).toBe(
      'PLANNING_PERIOD_STRUCTURAL_FROZEN',
    );
  });

  it('rechaza versiones obsoletas', async () => {
    const stale = await apiCall(
      'PATCH',
      `/planning-periods/${periodAId}`,
      {
        expectedVersion: 1,
        expectedDeliveryDate: '2031-03-11',
      },
      adminToken,
    );
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { code: string }).code).toBe('VERSION_CONFLICT');
  });

  it('registra auditoría por creación, edición y transición', async () => {
    // create + close + editable patch + to PURCHASING; los rechazos no auditan.
    expect(await countAuditEvents(periodAId)).toBe(4);
  });

  it('no modifica authorization_items', async () => {
    const items = await database.query<{ count: number }>(
      `select count(*)::int as count from authorization_items`,
    );
    expect(items.rows[0]?.count).toBe(authorizationItemsBefore);
  });

  it('un usuario con solo planning_periods.read consulta pero no escribe', async () => {
    const list = await apiCall('GET', '/planning-periods', undefined, readOnlyToken);
    expect(list.status).toBe(200);

    const detail = await apiCall('GET', `/planning-periods/${periodAId}`, undefined, readOnlyToken);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { id: string }).id).toBe(periodAId);

    const create = await apiCall(
      'POST',
      '/planning-periods',
      {
        startDate: '2031-06-02',
        endDate: '2031-06-08',
        schedulingCutoffAt: '2031-06-03T23:59:00-05:00',
        purchaseOrderDeadlineAt: '2031-06-04T23:59:00-05:00',
        expectedDeliveryDate: '2031-06-09',
      },
      readOnlyToken,
    );
    expect(create.status).toBe(403);
    expect(((await create.json()) as { code: string }).code).toBe('PERMISSION_DENIED');

    const patch = await apiCall(
      'PATCH',
      `/planning-periods/${periodAId}`,
      { expectedVersion: 4, expectedDeliveryDate: '2031-03-11' },
      readOnlyToken,
    );
    expect(patch.status).toBe(403);
    expect(((await patch.json()) as { code: string }).code).toBe('PERMISSION_DENIED');

    const transition = await apiCall(
      'POST',
      `/planning-periods/${periodAId}/transition`,
      { to: 'IN_FULFILLMENT', expectedVersion: 4 },
      readOnlyToken,
    );
    expect(transition.status).toBe(403);
    expect(((await transition.json()) as { code: string }).code).toBe('PERMISSION_DENIED');

    // Los rechazos no deben dejar rastro de escritura.
    const written = await database.query<{ count: number }>(
      `select count(*)::int as count from planning_periods where start_date = '2031-06-02'`,
    );
    expect(written.rows[0]?.count).toBe(0);
  });
});
