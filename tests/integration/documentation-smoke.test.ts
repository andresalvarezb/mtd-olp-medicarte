import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  ensureUser,
  grantAllPointsToMedicarteOperator,
} from './helpers/auth';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const db = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization',
});
const suffix = randomUUID().slice(0, 8);
let mtdToken = '';
let olpToken = '';
let medicarteToken = '';

async function get(path: string, token: string, organizationId: string): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
    },
  });
}

describe('HTTP documentation smoke — synthetic operational actors', () => {
  beforeAll(async () => {
    await db.connect();
    const adminToken = await adminLogin();
    mtdToken = await ensureUser({
      adminToken,
      username: `docs-smoke-mtd-${suffix}`,
      displayName: 'Documentation smoke MTD',
      password: `docs-smoke-${suffix}-pw`,
      organizationId: ORGANIZATION_IDS.MTD,
      roleCode: 'MTD_GENERAL',
    });
    ({ olpToken, medicarteToken } = await ensureOperatorTokens());
    await grantAllPointsToMedicarteOperator(db);
  });

  afterAll(async () => {
    await db.end();
  });

  it('authenticates each actor and enforces each organization permission', async () => {
    const [mtd, olp, medicarte, anonymous] = await Promise.all([
      get('/planning-periods', mtdToken, ORGANIZATION_IDS.MTD),
      get('/supplier/purchase-orders', olpToken, ORGANIZATION_IDS.OLP),
      get('/inventory', medicarteToken, ORGANIZATION_IDS.MEDICARTE),
      fetch(`${apiUrl}/api/v1/planning-periods`, {
        headers: { 'x-organization-id': ORGANIZATION_IDS.MTD },
      }),
    ]);

    expect(mtd.status).toBe(200);
    expect(olp.status).toBe(200);
    expect(medicarte.status).toBe(200);
    expect(anonymous.status).toBe(401);

    const [mtdBody, olpBody, medicarteBody] = await Promise.all([
      mtd.json() as Promise<{ items: unknown[] }>,
      olp.json() as Promise<{ items: unknown[] }>,
      medicarte.json() as Promise<{ items: unknown[] }>,
    ]);
    expect(Array.isArray(mtdBody.items)).toBe(true);
    expect(Array.isArray(olpBody.items)).toBe(true);
    expect(Array.isArray(medicarteBody.items)).toBe(true);
  });
});
