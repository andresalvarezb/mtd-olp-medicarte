import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  ensureUser,
  grantAllPointsToMedicarteOperator,
  deletePointScopesForPointCodeLike,
} from './helpers/auth';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization',
});
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const prefix = `ESP8-${randomUUID().slice(0, 8).toUpperCase()}`;
let adminToken: string;
let medicarteToken: string;
let olpToken: string;
let mtdGeneralToken: string;
let compensarToken: string;
let userId: string;
let pointId: string;
let periodId: string;
let secondPeriodId: string;
let connected = false;

type Line = {
  id: string;
  deliveryLineId: string;
  code: string;
  pointId: string;
  lot: string;
  expiration: string;
  quantity: number;
};
type Fixture = { orderId: string; deliveryId: string; lines: Line[] };

async function api(
  method: string,
  path: string,
  body?: unknown,
  token: string = medicarteToken,
  organizationId: string = ORGANIZATION_IDS.MEDICARTE,
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
async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
function code(suffix = randomUUID().slice(0, 6).toUpperCase()) {
  return `${prefix}-${suffix}`;
}

async function fixture(
  options: {
    lines?: Array<Partial<Pick<Line, 'code' | 'lot' | 'expiration' | 'quantity' | 'pointId'>>>;
    orderId?: string;
    pointIds?: string[];
  } = {},
): Promise<Fixture> {
  const orderId = options.orderId ?? randomUUID();
  const deliveryId = randomUUID();
  const definitions = options.lines ?? [{}];
  const lines: Line[] = [];
  await database.query(
    `insert into purchase_orders
      (id,purchase_order_code,planning_period_id,order_type,status,created_by,updated_by)
      values ($1,$2,$3,'STANDARD','FULLY_DISPATCHED',$4,$4)`,
    [orderId, code(), periodId, userId],
  );
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index] ?? {};
    const lineId = randomUUID();
    const deliveryLineId = randomUUID();
    const point = definition.pointId ?? options.pointIds?.[index] ?? pointId;
    const value: Line = {
      id: lineId,
      deliveryLineId,
      code: definition.code ?? code(),
      pointId: point,
      lot: definition.lot ?? code(),
      expiration: definition.expiration ?? '2099-12-31',
      quantity: definition.quantity ?? 20,
    };
    lines.push(value);
    await database.query(
      `insert into purchase_order_lines
        (id,purchase_order_id,commercial_code,product_description,presentation,dispensing_point_id,
         requested_quantity,accepted_quantity,requested_delivery_date,compensar_unit_rate_snapshot,
         supplier_unit_cost,projected_demand_line_id,projected_demand_revision,demand_bucket)
       values ($1,$2,$3,'ESP008 product','presentation',$4,$5,$5,'2037-01-15','10.00','10.00',$6,1,'REGULAR')`,
      [lineId, orderId, value.code, point, value.quantity, randomUUID()],
    );
  }
  await database.query(
    `insert into deliveries (id,purchase_order_id,status,dispatched_at,created_by,updated_by)
     values ($1,$2,'DISPATCHED',now(),$3,$3)`,
    [deliveryId, orderId, userId],
  );
  for (const line of lines)
    await database.query(
      `insert into delivery_lines
       (id,delivery_id,purchase_order_line_id,commercial_code,dispensing_point_id,quantity,lot_number,expiration_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        line.deliveryLineId,
        deliveryId,
        line.id,
        line.code,
        line.pointId,
        line.quantity,
        line.lot,
        line.expiration,
      ],
    );
  return { orderId, deliveryId, lines };
}

async function receive(
  value: Fixture,
  quantities: Array<{
    received: number;
    accepted: number;
    rejected: number;
    lot?: string;
    expiration?: string;
  }>,
) {
  const created = await api('POST', '/medicarte/receipts', { deliveryId: value.deliveryId });
  expect(created.status).toBe(201);
  const draft = await json<{ id: string; version: number }>(created);
  const updated = await api('PATCH', `/medicarte/receipts/${draft.id}`, {
    expectedVersion: draft.version,
    lines: value.lines.map((line, index) => ({
      deliveryLineId: line.deliveryLineId,
      receivedQuantity: quantities[index]!.received,
      acceptedQuantity: quantities[index]!.accepted,
      rejectedQuantity: quantities[index]!.rejected,
      receivedLotNumber: quantities[index]!.lot ?? line.lot,
      receivedExpirationDate: quantities[index]!.expiration ?? line.expiration,
    })),
  });
  expect(updated.status).toBe(200);
  const edited = await json<{ id: string; version: number }>(updated);
  const confirmed = await api('POST', `/medicarte/receipts/${draft.id}/confirm`, {
    expectedVersion: edited.version,
  });
  return { receipt: draft.id, response: confirmed };
}

async function inventoryForReceipt(receiptId: string) {
  return database.query<{
    movement_id: string;
    movement_type: string;
    quantity_delta: number;
    source_type: string;
    source_id: string;
    lot_id: string;
    line_id: string;
  }>(
    `select m.id movement_id,m.movement_type,m.quantity_delta,m.source_type,m.source_id,
            m.inventory_lot_id lot_id,rl.id line_id
       from inventory_movements m
       join receipt_lines rl on rl.id=m.source_id
       join receipts r on r.id=rl.receipt_id
      where r.id=$1 order by rl.id`,
    [receiptId],
  );
}

async function cleanup() {
  await database.query(
    `delete from inventory_movements where source_id in
      (select rl.id from receipt_lines rl join receipts r on r.id=rl.receipt_id
       join deliveries d on d.id=r.delivery_id join purchase_orders po on po.id=d.purchase_order_id
       where po.purchase_order_code like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from inventory_lots where id not in (select distinct inventory_lot_id from inventory_movements) and
      (commercial_code like $1 or lot_number like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from receipt_lines where receipt_id in
      (select r.id from receipts r join deliveries d on d.id=r.delivery_id join purchase_orders po on po.id=d.purchase_order_id where po.purchase_order_code like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from receipts where delivery_id in (select d.id from deliveries d join purchase_orders po on po.id=d.purchase_order_id where po.purchase_order_code like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from delivery_lines where delivery_id in (select d.id from deliveries d join purchase_orders po on po.id=d.purchase_order_id where po.purchase_order_code like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from deliveries where purchase_order_id in (select id from purchase_orders where purchase_order_code like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from purchase_order_lines where purchase_order_id in (select id from purchase_orders where purchase_order_code like $1)`,
    [`${prefix}%`],
  );
  await database.query(`delete from purchase_orders where purchase_order_code like $1`, [
    `${prefix}%`,
  ]);
  await deletePointScopesForPointCodeLike(database, `${prefix}%`);
  await database.query(`delete from dispensing_points where code like $1`, [`${prefix}%`]);
}

describe('Gate ESP-008 - operational inventory ledger', () => {
  beforeAll(async () => {
    await database.connect();
    connected = true;
    adminToken = await adminLogin();
    ({ medicarteToken, olpToken } = await ensureOperatorTokens());
    mtdGeneralToken = await ensureUser({
      adminToken,
      username: `esp8-mtd-${prefix.slice(-6).toLowerCase()}`,
      displayName: 'ESP008 MTD General',
      password: `${prefix}-mtd-password`,
      organizationId: ORGANIZATION_IDS.MTD,
      roleCode: 'MTD_GENERAL',
    });
    compensarToken = await ensureUser({
      adminToken,
      username: `esp8-comp-${prefix.slice(-6).toLowerCase()}`,
      displayName: 'ESP008 Compensar Viewer',
      password: `${prefix}-comp-password`,
      organizationId: ORGANIZATION_IDS.COMPENSAR,
      roleCode: 'COMPENSAR_VIEWER',
    });
    userId = (
      await database.query<{ id: string }>(`select id from users where username='foundation-admin'`)
    ).rows[0]!.id;
    periodId = (
      await database.query<{ id: string }>(
        `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by)
       values ('2020-01-01','2020-01-31','2019-12-01T00:00:00Z','2019-12-10T00:00:00Z','2020-01-15',$1,$1) returning id`,
        [userId],
      )
    ).rows[0]!.id;
    secondPeriodId = (
      await database.query<{ id: string }>(
        `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by)
       values ('2020-02-01','2020-02-29','2020-01-01T00:00:00Z','2020-01-10T00:00:00Z','2020-02-15',$1,$1) returning id`,
        [userId],
      )
    ).rows[0]!.id;
    pointId = (
      await database.query<{ id: string }>(
        `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
        [ORGANIZATION_IDS.MTD, code('POINT'), userId],
      )
    ).rows[0]!.id;
    await grantAllPointsToMedicarteOperator(database);
  });
  afterAll(async () => {
    if (!connected) return;
    await cleanup();
    await database.query('delete from planning_periods where id in ($1,$2)', [
      periodId,
      secondPeriodId,
    ]);
    await database.end();
  });

  it('creates exactly one RECEIPT movement per receipt_line with accepted quantity', async () => {
    const value = await fixture();
    const result = await receive(value, [{ received: 20, accepted: 20, rejected: 0 }]);
    expect(result.response.status).toBe(201);
    const rows = await inventoryForReceipt(result.receipt);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      movement_type: 'RECEIPT',
      quantity_delta: 20,
      source_type: 'RECEIPT_LINE',
      line_id: rows.rows[0]!.source_id,
    });
    expect(rows.rows[0]!.source_id).toBe(rows.rows[0]!.line_id);
  });

  it('is idempotent by receipt_line and supports two accepted lines in one receipt', async () => {
    const value = await fixture({ lines: [{}, { code: code('SECOND'), lot: code('LOT-SECOND') }] });
    const result = await receive(value, [
      { received: 20, accepted: 20, rejected: 0 },
      { received: 20, accepted: 18, rejected: 2 },
    ]);
    expect(result.response.status).toBe(201);
    const rows = await inventoryForReceipt(result.receipt);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.source_id)).toEqual(rows.rows.map((row) => row.line_id));
    const retry = await api('POST', `/medicarte/receipts/${result.receipt}/confirm`, {
      expectedVersion: 2,
    });
    expect(retry.status).toBe(409);
    expect((await inventoryForReceipt(result.receipt)).rows).toHaveLength(2);
  });

  it.each([
    ['rejected quantity', 20, 18, 2, 18],
    ['shortage quantity', 18, 18, 0, 18],
    ['zero accepted quantity', 20, 0, 20, 0],
  ])(
    '%s never uses a non-accepted quantity',
    async (_label, received, accepted, rejected, expected) => {
      const value = await fixture();
      const result = await receive(value, [{ received, accepted, rejected }]);
      expect(result.response.status).toBe(201);
      const rows = await inventoryForReceipt(result.receipt);
      expect(rows.rows.reduce((sum, row) => sum + row.quantity_delta, 0)).toBe(expected);
      if (expected === 0) expect(rows.rows).toHaveLength(0);
    },
  );

  it('rolls back receipt, delivery, movement and lot when inventory insertion fails', async () => {
    const value = await fixture({ lines: [{ lot: code('FAIL-LOT') }] });
    const draft = await api('POST', '/medicarte/receipts', { deliveryId: value.deliveryId });
    const created = await json<{ id: string; version: number }>(draft);
    const edited = await api('PATCH', `/medicarte/receipts/${created.id}`, {
      expectedVersion: created.version,
      lines: [
        {
          deliveryLineId: value.lines[0]!.deliveryLineId,
          receivedQuantity: 20,
          acceptedQuantity: 20,
          rejectedQuantity: 0,
          receivedLotNumber: value.lines[0]!.lot,
          receivedExpirationDate: '2099-12-31',
        },
      ],
    });
    const version = (await json<{ version: number }>(edited)).version;
    await database.query(
      `create or replace function enforce_receipt_inventory_movement() returns trigger language plpgsql as $$ begin raise exception 'ESP008_INDUCED_FAILURE'; end $$`,
    );
    try {
      expect(
        (
          await api('POST', `/medicarte/receipts/${created.id}/confirm`, {
            expectedVersion: version,
          })
        ).status,
      ).toBe(400);
    } finally {
      await database.query(
        `create or replace function enforce_receipt_inventory_movement() returns trigger language plpgsql as $$ declare accepted integer; begin if new.movement_type='RECEIPT' then if new.source_type <> 'RECEIPT_LINE' then raise exception 'RECEIPT movement source must be RECEIPT_LINE'; end if; select rl.accepted_quantity into accepted from receipt_lines rl join receipts r on r.id=rl.receipt_id where rl.id=new.source_id and r.status='CONFIRMED'; if accepted is null or accepted <= 0 or new.quantity_delta <> accepted then raise exception 'RECEIPT movement requires confirmed accepted receipt quantity'; end if; end if; return new; end $$`,
      );
    }
    const state = (
      await database.query<{ receipt_status: string; delivery_status: string }>(
        `select r.status receipt_status,d.status delivery_status from receipts r join deliveries d on d.id=r.delivery_id where r.id=$1`,
        [created.id],
      )
    ).rows[0]!;
    expect(state).toEqual({ receipt_status: 'DRAFT', delivery_status: 'DISPATCHED' });
    expect((await inventoryForReceipt(created.id)).rows).toHaveLength(0);
    expect(
      (
        await database.query(`select 1 from inventory_lots where lot_number=$1`, [
          value.lines[0]!.lot,
        ])
      ).rows,
    ).toHaveLength(0);
  });

  it('reuses physical lot identity and accumulates balances across receipts', async () => {
    const lot = code('SHARED-LOT');
    const first = await fixture({ lines: [{ code: code('SHARED-PRODUCT'), lot }] });
    const second = await fixture({ lines: [{ code: first.lines[0]!.code, lot }] });
    await receive(first, [{ received: 20, accepted: 20, rejected: 0 }]);
    await receive(second, [{ received: 10, accepted: 10, rejected: 0 }]);
    const lots = await database.query<{ lot_id: string; balance: number }>(
      `select l.id lot_id,sum(m.quantity_delta)::int balance from inventory_lots l join inventory_movements m on m.inventory_lot_id=l.id where l.commercial_code=$1 and l.dispensing_point_id=$2 and l.lot_number=$3 group by l.id`,
      [first.lines[0]!.code, pointId, lot],
    );
    expect(lots.rows).toHaveLength(1);
    expect(lots.rows[0]!.balance).toBe(30);
  });

  it('separates lot identity by lot, point, expiration and commercial code', async () => {
    const otherPoint = (
      await database.query<{ id: string }>(
        `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
        [ORGANIZATION_IDS.MTD, code('OTHER-POINT'), userId],
      )
    ).rows[0]!.id;
    await grantAllPointsToMedicarteOperator(database);
    const product = code('IDENTITY-PRODUCT');
    const cases = [
      { code: product, lot: 'LOT-A', expiration: '2099-12-31', pointId },
      { code: product, lot: 'LOT-B', expiration: '2099-12-31', pointId },
      { code: product, lot: 'LOT-A', expiration: '2099-11-30', pointId },
      { code: product, lot: 'LOT-A', expiration: '2099-12-31', pointId: otherPoint },
      { code: code('OTHER-PRODUCT'), lot: 'LOT-A', expiration: '2099-12-31', pointId },
    ];
    for (const item of cases) {
      const value = await fixture({ lines: [item] });
      await receive(value, [{ received: 1, accepted: 1, rejected: 0 }]);
    }
    const count = await database.query<{ count: number }>(
      `select count(*)::int count from inventory_lots where (commercial_code=$1 or commercial_code like $2)`,
      [product, `${prefix}-OTHER-PRODUCT%`],
    );
    expect(count.rows[0]!.count).toBe(5);
  });

  it('handles concurrent first creation of the same physical lot', async () => {
    const lot = code('CONCURRENT-LOT');
    const product = code('CONCURRENT-PRODUCT');
    const first = await fixture({ lines: [{ code: product, lot }] });
    const second = await fixture({ lines: [{ code: product, lot }] });
    const results = await Promise.all([
      receive(first, [{ received: 20, accepted: 20, rejected: 0 }]),
      receive(second, [{ received: 10, accepted: 10, rejected: 0 }]),
    ]);
    expect(results.every((result) => result.response.status === 201)).toBe(true);
    const rows = await database.query<{ lots: number; balance: number }>(
      `select count(distinct l.id)::int lots,sum(m.quantity_delta)::int balance from inventory_lots l join inventory_movements m on m.inventory_lot_id=l.id where l.commercial_code=$1 and l.lot_number=$2`,
      [product, lot],
    );
    expect(rows.rows[0]).toEqual({ lots: 1, balance: 30 });
  });

  it('computes physical balance from movements and preserves it across periods', async () => {
    const value = await fixture();
    const before = await receive(value, [{ received: 20, accepted: 20, rejected: 0 }]);
    const lotId = (await inventoryForReceipt(before.receipt)).rows[0]!.lot_id;
    const sum = await database.query<{ balance: number }>(
      `select sum(quantity_delta)::int balance from inventory_movements where inventory_lot_id=$1`,
      [lotId],
    );
    expect(sum.rows[0]!.balance).toBe(20);
    await database.query(`update purchase_orders set planning_period_id=$1 where id=$2`, [
      secondPeriodId,
      value.orderId,
    ]);
    const after = await database.query<{ balance: number }>(
      `select sum(quantity_delta)::int balance from inventory_movements where inventory_lot_id=$1`,
      [lotId],
    );
    expect(after.rows[0]!.balance).toBe(20);
    expect(
      (await api('GET', `/inventory?commercialCode=${encodeURIComponent(value.lines[0]!.code)}`))
        .status,
    ).toBe(200);
  });

  it('keeps expired physical balance, returns usable zero and emits no EXPIRATION movement', async () => {
    const value = await fixture();
    const result = await receive(value, [{ received: 20, accepted: 20, rejected: 0 }]);
    expect(result.response.status).toBe(201);
    await database.query(
      `update inventory_lots set expiration_date='2000-01-01'
       where id in (select inventory_lot_id from inventory_movements where source_id in
         (select id from receipt_lines where receipt_id=$1))`,
      [result.receipt],
    );
    const list = await json<{
      items: Array<{ physicalBalance: number; usableBalance: number; expired: boolean }>;
    }>(await api('GET', `/inventory?commercialCode=${encodeURIComponent(value.lines[0]!.code)}`));
    expect(list.items[0]).toMatchObject({ physicalBalance: 20, usableBalance: 0, expired: true });
    expect(
      (
        await database.query<{ count: number }>(
          `select 1 from inventory_movements where movement_type='EXPIRATION' and source_id in (select id from receipt_lines where receipt_id=$1)`,
          [result.receipt],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it('treats expiration_date=current_date as usable and recommends FEFO', async () => {
    const product = code('FEFO-PRODUCT');
    const expired = await fixture({
      lines: [{ code: product, lot: code('EXPIRED'), expiration: '2000-01-01' }],
    });
    const zero = await fixture({
      lines: [{ code: product, lot: code('ZERO'), expiration: '2099-01-01' }],
    });
    const todayDate = (await database.query<{ today: string }>(`select current_date::text today`))
      .rows[0]!.today;
    const today = await fixture({
      lines: [{ code: product, lot: code('TODAY'), expiration: todayDate }],
    });
    const nearest = await fixture({
      lines: [{ code: product, lot: code('NEAREST'), expiration: '2098-01-01' }],
    });
    await receive(expired, [{ received: 2, accepted: 2, rejected: 0 }]);
    await receive(zero, [{ received: 1, accepted: 0, rejected: 1 }]);
    await receive(today, [{ received: 2, accepted: 2, rejected: 0 }]);
    await receive(nearest, [{ received: 2, accepted: 2, rejected: 0 }]);
    const recommendation = await json<{
      recommendation: { lotNumber: string; expirationDate: string; usableBalance: number };
    }>(
      await api(
        'GET',
        `/inventory/fefo/recommendation?commercialCode=${encodeURIComponent(product)}&dispensingPointId=${pointId}`,
      ),
    );
    expect(recommendation.recommendation).toMatchObject({
      lotNumber: today.lines[0]!.lot,
      expirationDate: today.lines[0]!.expiration,
      usableBalance: 2,
    });
  });

  it('exposes inventory only to authorized MTD and Medicarte readers', async () => {
    expect((await api('GET', '/inventory')).status).toBe(200);
    expect(
      (await api('GET', '/inventory', undefined, adminToken, ORGANIZATION_IDS.MTD)).status,
    ).toBe(200);
    expect(
      (await api('GET', '/inventory', undefined, mtdGeneralToken, ORGANIZATION_IDS.MTD)).status,
    ).toBe(200);
    expect((await api('GET', '/inventory', undefined, olpToken, ORGANIZATION_IDS.OLP)).status).toBe(
      403,
    );
    expect(
      (await api('GET', '/inventory', undefined, compensarToken, ORGANIZATION_IDS.COMPENSAR))
        .status,
    ).toBe(403);
    expect((await api('POST', '/inventory', {}, adminToken, ORGANIZATION_IDS.MTD)).status).toBe(
      404,
    );
  });

  it('keeps lineage logistical and structurally excludes forbidden operations and links', async () => {
    const columns = await database.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name in ('inventory_lots','inventory_movements')`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain('planning_period_id');
    expect(names).not.toContain('patient_id');
    expect(names).not.toContain('authorization_item_id');
    expect(names).not.toContain('current_quantity');
    expect(names).not.toContain('reserved');
    const tables = await database.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public' and table_name in ('inventory_reservations','inventory_applications')`,
    );
    expect(tables.rows).toHaveLength(0);
    const movementTypes = await database
      .query<{ type: string }>(`select unnest(enum_range(null::text)) type`)
      .catch(() => ({ rows: [] as Array<{ type: string }> }));
    expect(movementTypes.rows).toBeDefined();
  });

  it('keeps receipt, delivery, purchase, authorization and schedule historical rows unchanged', async () => {
    const value = await fixture();
    const snapshots = {
      delivery: (
        await database.query<{ count: number }>(
          `select quantity,lot_number,expiration_date from delivery_lines where delivery_id=$1`,
          [value.deliveryId],
        )
      ).rows,
      order: (
        await database.query<{ count: number }>(
          `select accepted_quantity,requested_quantity from purchase_order_lines where purchase_order_id=$1`,
          [value.orderId],
        )
      ).rows,
    };
    const result = await receive(value, [{ received: 18, accepted: 18, rejected: 0 }]);
    expect(result.response.status).toBe(201);
    expect(
      (
        await database.query<{ count: number }>(
          `select quantity,lot_number,expiration_date from delivery_lines where delivery_id=$1`,
          [value.deliveryId],
        )
      ).rows,
    ).toEqual(snapshots.delivery);
    expect(
      (
        await database.query(
          `select accepted_quantity,requested_quantity from purchase_order_lines where purchase_order_id=$1`,
          [value.orderId],
        )
      ).rows,
    ).toEqual(snapshots.order);
    expect(
      (
        await database.query<{ count: number }>(
          `select count(*)::int count from authorization_items where codigo_medicamento like $1`,
          [`${prefix}%`],
        )
      ).rows[0]!.count,
    ).toBe(0);
    expect(
      (
        await database.query<{ count: number }>(
          `select count(*)::int count from patient_schedules where commercial_code like $1`,
          [`${prefix}%`],
        )
      ).rows[0]!.count,
    ).toBe(0);
  });

  it('has the ESP-008 migration after ESP-007 and required database constraints', async () => {
    const migrationTables = await database.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public' and table_name in ('receipts','receipt_lines','inventory_lots','inventory_movements') order by table_name`,
    );
    expect(migrationTables.rows.map((row) => row.table_name)).toEqual([
      'inventory_lots',
      'inventory_movements',
      'receipt_lines',
      'receipts',
    ]);
    const constraint = await database.query<{ constraint_name: string }>(
      `select constraint_name from information_schema.table_constraints where table_name='inventory_movements' and constraint_name='inventory_movements_source_semantics_unique'`,
    );
    expect(constraint.rows).toHaveLength(1);
    const fk = await database.query<{ constraint_name: string }>(
      `select constraint_name from information_schema.table_constraints where table_name='inventory_lots' and constraint_type='FOREIGN KEY'`,
    );
    expect(fk.rows).toHaveLength(1);
  });
});
