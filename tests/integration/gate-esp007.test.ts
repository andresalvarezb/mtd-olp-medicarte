import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  grantAllPointsToMedicarteOperator,
  deletePointScopesForPoints,
} from './helpers/auth';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization',
});
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
let adminToken: string;
let medicarteToken: string;
let olpToken: string;
let userId: string;
let pointId: string;
let periodId: string;
let periodCreated = false;
const fixture = `ESP7-${randomUUID().slice(0, 8).toUpperCase()}`;

type Fixture = {
  orderId: string;
  lineId: string;
  deliveryId: string;
  deliveryLineId: string;
  lot: string;
};
async function api(
  method: string,
  path: string,
  body?: unknown,
  token = medicarteToken,
  organizationId = ORGANIZATION_IDS.MEDICARTE,
) {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-organization-id': organizationId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function payload<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
async function fixtureDelivery(quantity = 20, orderId = randomUUID()): Promise<Fixture> {
  const lineId = randomUUID();
  const deliveryId = randomUUID();
  const deliveryLineId = randomUUID();
  const existingOrder = await database.query<{ id: string }>(
    'select id from purchase_orders where id=$1',
    [orderId],
  );
  if (!existingOrder.rows[0])
    await database.query(
      `insert into purchase_orders (id,purchase_order_code,planning_period_id,order_type,status,created_by,updated_by) values ($1,$2,$3,'STANDARD','FULLY_DISPATCHED',$4,$4)`,
      [orderId, `${fixture}-${orderId.slice(0, 4)}`, periodId, userId],
    );
  await database.query(
    `insert into purchase_order_lines (id,purchase_order_id,commercial_code,product_description,presentation,dispensing_point_id,requested_quantity,accepted_quantity,requested_delivery_date,compensar_unit_rate_snapshot,supplier_unit_cost,projected_demand_line_id,projected_demand_revision,demand_bucket) values ($1,$2,$3,'ESP7 product','presentation',$4,$5,$5,'2037-01-15','10.00','10.00',$6,1,'REGULAR')`,
    [lineId, orderId, `${fixture}-PRODUCT`, pointId, quantity, randomUUID()],
  );
  await database.query(
    `insert into deliveries (id,purchase_order_id,status,dispatched_at,created_by,updated_by) values ($1,$2,'DISPATCHED',now(),$3,$3)`,
    [deliveryId, orderId, userId],
  );
  await database.query(
    `insert into delivery_lines (id,delivery_id,purchase_order_line_id,commercial_code,dispensing_point_id,quantity,lot_number,expiration_date) values ($1,$2,$3,$4,$5,$6,$7,'2099-12-31')`,
    [deliveryLineId, deliveryId, lineId, `${fixture}-PRODUCT`, pointId, quantity, `${fixture}-LOT`],
  );
  return { orderId, lineId, deliveryId, deliveryLineId, lot: `${fixture}-LOT` };
}
async function createDraft(fixture: Fixture) {
  const response = await api('POST', '/medicarte/receipts', { deliveryId: fixture.deliveryId });
  if (response.status !== 201)
    throw new Error(
      `create receipt failed: ${response.status} ${JSON.stringify(await payload<unknown>(response))}`,
    );
  return payload<{ id: string; version: number }>(response);
}
async function save(
  fixture: Fixture,
  receiptId: string,
  version: number,
  quantities: { receivedQuantity: number; acceptedQuantity: number; rejectedQuantity: number },
  extra: Record<string, unknown> = {},
) {
  const response = await api('PATCH', `/medicarte/receipts/${receiptId}`, {
    expectedVersion: version,
    lines: [
      {
        deliveryLineId: fixture.deliveryLineId,
        ...quantities,
        receivedLotNumber: fixture.lot,
        receivedExpirationDate: '2099-12-31',
        ...extra,
      },
    ],
  });
  expect(response.status).toBe(200);
  return payload<{ id: string; version: number }>(response);
}
async function confirm(receiptId: string, version: number) {
  return api('POST', `/medicarte/receipts/${receiptId}/confirm`, { expectedVersion: version });
}
async function cleanup() {
  await database.query(
    `delete from inventory_movements where source_id in
      (select rl.id from receipt_lines rl join receipts r on r.id=rl.receipt_id
       join deliveries d on d.id=r.delivery_id join purchase_orders po on po.id=d.purchase_order_id
       where po.purchase_order_code like $1)`,
    [`${fixture}%`],
  );
  await database.query(
    `delete from inventory_lots where id not in (select distinct inventory_lot_id from inventory_movements)
       and (commercial_code like $1 or lot_number like $1)`,
    [`${fixture}%`],
  );
  await database.query(
    `delete from receipt_lines where receipt_id in (select r.id from receipts r join deliveries d on d.id=r.delivery_id join purchase_orders po on po.id=d.purchase_order_id where po.purchase_order_code like $1)`,
    [`${fixture}%`],
  );
  await database.query(
    `delete from receipts where delivery_id in (select id from deliveries where purchase_order_id in (select id from purchase_orders where purchase_order_code like $1))`,
    [`${fixture}%`],
  );
  await database.query(
    `delete from delivery_lines where delivery_id in (select id from deliveries where purchase_order_id in (select id from purchase_orders where purchase_order_code like $1))`,
    [`${fixture}%`],
  );
  await database.query(
    `delete from deliveries where purchase_order_id in (select id from purchase_orders where purchase_order_code like $1)`,
    [`${fixture}%`],
  );
  await database.query(
    `delete from purchase_order_lines where purchase_order_id in (select id from purchase_orders where purchase_order_code like $1)`,
    [`${fixture}%`],
  );
  await database.query(`delete from purchase_orders where purchase_order_code like $1`, [
    `${fixture}%`,
  ]);
}

describe('Gate ESP-007 - API/integration hardening', () => {
  beforeAll(async () => {
    await database.connect();
    adminToken = await adminLogin();
    ({ medicarteToken, olpToken } = await ensureOperatorTokens());
    userId = (
      await database.query<{ id: string }>(`select id from users where username='foundation-admin'`)
    ).rows[0]!.id;
    const existingPeriod = await database.query<{ id: string }>(
      `select id from planning_periods where start_date='2038-01-01' and end_date='2038-01-31' limit 1`,
    );
    periodId =
      existingPeriod.rows[0]?.id ??
      (
        await database.query<{ id: string }>(
          `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2038-01-01','2038-01-31','2037-12-01T00:00:00Z','2037-12-10T00:00:00Z','2038-01-15',$1,$1) returning id`,
          [userId],
        )
      ).rows[0]!.id;
    periodCreated = existingPeriod.rows.length === 0;
    pointId = (
      await database.query<{ id: string }>(
        `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
        [ORGANIZATION_IDS.MTD, fixture, userId],
      )
    ).rows[0]!.id;
    await grantAllPointsToMedicarteOperator(database);
  });
  afterAll(async () => {
    await cleanup();
    await deletePointScopesForPoints(database, [pointId]);
    await database.query('delete from dispensing_points where id=$1', [pointId]);
    if (periodCreated) {
      await database.query('delete from planning_periods where id=$1', [periodId]);
    }
    await database.end();
  });

  it('confirms total, rejection partial, shortage partial, total rejection and total shortage through HTTP', async () => {
    for (const [received, accepted, rejected, conformity] of [
      [20, 20, 0, 'CONFORMING'],
      [20, 18, 2, 'PARTIALLY_CONFORMING'],
      [18, 18, 0, 'PARTIALLY_CONFORMING'],
      [20, 0, 20, 'NON_CONFORMING'],
      [0, 0, 0, 'NON_CONFORMING'],
    ] as const) {
      const delivery = await fixtureDelivery();
      const draft = await createDraft(delivery);
      const edited = await save(delivery, draft.id, draft.version, {
        receivedQuantity: received,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
      });
      const response = await confirm(draft.id, edited.version);
      expect(response.status).toBe(201);
      const receipt = await payload<{
        conformity: string;
        lines: Array<{ shortageQuantity: number }>;
      }>(response);
      expect(receipt.conformity).toBe(conformity);
      expect(receipt.lines[0]!.shortageQuantity).toBe(20 - received);
      const state = await database.query<{ status: string }>(
        'select status from deliveries where id=$1',
        [delivery.deliveryId],
      );
      const expectedDeliveryStatus =
        received >= 20
          ? 'RECEIVED'
          : 'DISPATCHED';

      expect(
        state.rows[0]!.status,
      ).toBe(
        expectedDeliveryStatus,
      );
    }
  });

  it('rejects over-receipt atomically and preserves draft and dispatched delivery', async () => {
    const delivery = await fixtureDelivery();
    const draft = await createDraft(delivery);
    const response = await api('PATCH', `/medicarte/receipts/${draft.id}`, {
      expectedVersion: draft.version,
      lines: [
        {
          deliveryLineId: delivery.deliveryLineId,
          receivedQuantity: 21,
          acceptedQuantity: 21,
          rejectedQuantity: 0,
          receivedLotNumber: delivery.lot,
          receivedExpirationDate: '2099-12-31',
        },
      ],
    });
    expect(response.status).toBe(400);
    const state = await database.query<{
      receipt_status: string;
      delivery_status: string;
      confirmed_at: string | null;
      conformity: string | null;
    }>(
      `select r.status receipt_status,d.status delivery_status,r.confirmed_at,r.conformity from receipts r join deliveries d on d.id=r.delivery_id where r.id=$1`,
      [draft.id],
    );
    expect(state.rows[0]).toMatchObject({
      receipt_status: 'DRAFT',
      delivery_status: 'DISPATCHED',
      confirmed_at: null,
      conformity: null,
    });
  });

  it('preserves expected and observed lot/expiration discrepancies and delivery history', async () => {
    const delivery = await fixtureDelivery();
    const before = await database.query<{
      lot_number: string;
      expiration_date: string;
      quantity: number;
    }>('select lot_number,expiration_date::text,quantity from delivery_lines where id=$1', [
      delivery.deliveryLineId,
    ]);
    const draft = await createDraft(delivery);
    const edited = await save(
      delivery,
      draft.id,
      draft.version,
      { receivedQuantity: 20, acceptedQuantity: 20, rejectedQuantity: 0 },
      { receivedLotNumber: 'OBSERVED-LOT', receivedExpirationDate: '2099-11-30' },
    );
    const response = await confirm(draft.id, edited.version);
    expect(response.status).toBe(201);
    const receipt = await payload<{
      lines: Array<{
        expectedLotNumber: string;
        receivedLotNumber: string;
        expectedExpirationDate: string;
        receivedExpirationDate: string;
        conformity: string;
      }>;
    }>(response);
    expect(receipt.lines[0]).toMatchObject({
      expectedLotNumber: before.rows[0]!.lot_number,
      receivedLotNumber: 'OBSERVED-LOT',
      expectedExpirationDate: before.rows[0]!.expiration_date,
      receivedExpirationDate: '2099-11-30',
      conformity: 'PARTIALLY_CONFORMING',
    });
    expect(
      (
        await database.query(
          'select lot_number,expiration_date::text,quantity from delivery_lines where id=$1',
          [delivery.deliveryLineId],
        )
      ).rows[0],
    ).toEqual(before.rows[0]);
  });

  it('rejects expired accepted product with complete rollback', async () => {
    const delivery = await fixtureDelivery();
    const draft = await createDraft(delivery);
    const edited = await save(
      delivery,
      draft.id,
      draft.version,
      { receivedQuantity: 20, acceptedQuantity: 20, rejectedQuantity: 0 },
      { receivedExpirationDate: '2000-01-01' },
    );
    expect((await confirm(draft.id, edited.version)).status).toBe(409);
    expect(
      (
        await database.query<{
          status: string;
          conformity: string | null;
          confirmed_at: string | null;
        }>('select status,conformity,confirmed_at from receipts where id=$1', [draft.id])
      ).rows[0],
    ).toMatchObject({ status: 'DRAFT', conformity: null, confirmed_at: null });
    expect(
      (
        await database.query<{ status: string }>('select status from deliveries where id=$1', [
          delivery.deliveryId,
        ])
      ).rows[0]!.status,
    ).toBe('DISPATCHED');
  });

  it('allows only one concurrent confirmation and enforces one receipt per delivery', async () => {
    const delivery = await fixtureDelivery();
    const draft = await createDraft(delivery);
    const edited = await save(delivery, draft.id, draft.version, {
      receivedQuantity: 20,
      acceptedQuantity: 20,
      rejectedQuantity: 0,
    });
    const responses = await Promise.all([
      confirm(draft.id, edited.version),
      confirm(draft.id, edited.version),
    ]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    expect(
      (await api('POST', '/medicarte/receipts', { deliveryId: delivery.deliveryId })).status,
    ).toBe(409);
    expect(
      (
        await database.query<{ count: number }>(
          'select count(*)::int count from receipts where delivery_id=$1',
          [delivery.deliveryId],
        )
      ).rows[0]!.count,
    ).toBe(1);
  });

  it('derives PO processing status across two deliveries independently of conformity', async () => {
    const orderId = randomUUID();
    const first = await fixtureDelivery(20, orderId);
    const second = await fixtureDelivery(20, orderId);
    const firstDraft = await createDraft(first);
    const firstEdit = await save(first, firstDraft.id, firstDraft.version, {
      receivedQuantity: 20,
      acceptedQuantity: 20,
      rejectedQuantity: 0,
    });
    expect((await confirm(firstDraft.id, firstEdit.version)).status).toBe(201);
    expect(
      (
        await database.query<{ status: string }>('select status from purchase_orders where id=$1', [
          orderId,
        ])
      ).rows[0]!.status,
    ).toBe('PARTIALLY_RECEIVED');
    const secondDraft = await createDraft(second);
    const secondEdit = await save(second, secondDraft.id, secondDraft.version, {
      receivedQuantity: 20,
      acceptedQuantity: 18,
      rejectedQuantity: 2,
    });
    expect((await confirm(secondDraft.id, secondEdit.version)).status).toBe(201);
    expect(
      (
        await database.query<{ status: string }>('select status from purchase_orders where id=$1', [
          orderId,
        ])
      ).rows[0]!.status,
    ).toBe('RECEIVED');
  });

  it('keeps fulfillment and PO accepted quantity unchanged after partial receipt', async () => {
    const delivery = await fixtureDelivery();
    const before = await database.query<{ accepted_quantity: number }>(
      'select accepted_quantity from purchase_order_lines where id=$1',
      [delivery.lineId],
    );
    const draft = await createDraft(delivery);
    const edited = await save(delivery, draft.id, draft.version, {
      receivedQuantity: 18,
      acceptedQuantity: 18,
      rejectedQuantity: 0,
    });
    expect((await confirm(draft.id, edited.version)).status).toBe(201);
    expect(
      (
        await database.query<{ accepted_quantity: number }>(
          'select accepted_quantity from purchase_order_lines where id=$1',
          [delivery.lineId],
        )
      ).rows[0],
    ).toEqual(before.rows[0]);
    const line = (await (
      await api(
        'GET',
        `/supplier/deliveries/${delivery.deliveryId}`,
        undefined,
        olpToken,
        ORGANIZATION_IDS.OLP,
      )
    ).json()) as { lines: Array<{ dispatchedQuantity: number; remainingQuantity: number }> };
    expect(line.lines[0]).toMatchObject({ dispatchedQuantity: 20, remainingQuantity: 0 });
  });

  it('rejects mutation after confirmation and enforces API RBAC/read model boundaries', async () => {
    const delivery = await fixtureDelivery();
    const draft = await createDraft(delivery);
    const edited = await save(delivery, draft.id, draft.version, {
      receivedQuantity: 20,
      acceptedQuantity: 20,
      rejectedQuantity: 0,
    });
    expect((await confirm(draft.id, edited.version)).status).toBe(201);
    expect(
      (
        await api('PATCH', `/medicarte/receipts/${draft.id}`, {
          expectedVersion: edited.version + 1,
          lines: [
            {
              deliveryLineId: delivery.deliveryLineId,
              receivedQuantity: 20,
              acceptedQuantity: 20,
              rejectedQuantity: 0,
              receivedLotNumber: 'CHANGED',
              receivedExpirationDate: '2099-12-31',
            },
          ],
        })
      ).status,
    ).toBe(409);
    expect((await api('DELETE', `/medicarte/receipts/${draft.id}`, {})).status).toBe(404);
    const olp = await api('GET', '/olp/receipts', undefined, olpToken, ORGANIZATION_IDS.OLP);
    expect(olp.status).toBe(200);
    const olpBody = await payload<{ items: Array<Record<string, unknown>> }>(olp);
    expect(olpBody.items[0]).not.toHaveProperty('patientDocument');
    expect(olpBody.items[0]).not.toHaveProperty('supplierUnitCost');
    expect(
      (await api('GET', '/medicarte/receipts', undefined, adminToken, ORGANIZATION_IDS.MTD)).status,
    ).toBe(200);
    expect(
      (await api('GET', '/medicarte/receipts', undefined, adminToken, ORGANIZATION_IDS.COMPENSAR))
        .status,
    ).toBe(403);
  });

  it('leaves inventory operations outside ESP-007 scope', async () => {
    const tables = await database.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public' and table_name in ('inventory_lots','inventory_movements')`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'inventory_lots',
      'inventory_movements',
    ]);
  });
});
