import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  ensureUser,
  grantAllPointsToMedicarteOperator,
  deletePointScopesForPoints,
} from './helpers/auth';

const url =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const db = new Client({ connectionString: url });
const prefix = `ESP9-${randomUUID().slice(0, 8).toUpperCase()}`;
let token = '';
let admin = '';
let userId = '';
let source = '';
let destination = '';
let lot = '';
let connected = false;
async function api(
  method: string,
  path: string,
  body?: unknown,
  bearer = token,
  organizationId = ORGANIZATION_IDS.MEDICARTE,
) {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      'x-organization-id': organizationId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json<T>(response: Response) {
  return (await response.json()) as T;
}
async function createStock(quantity = 10) {
  const movement = await db.query<{ id: string }>(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'ADJUSTMENT',$2,'TRANSFER_LINE',$3,now(),$4) returning id`,
    [lot, quantity, randomUUID(), userId],
  );
  return movement.rows[0]!.id;
}
async function transfer(quantity: number) {
  const response = await api('POST', '/inventory/transfers', {
    sourceDispensingPointId: source,
    destinationDispensingPointId: destination,
    lines: [{ sourceInventoryLotId: lot, quantity }],
  });
  expect(response.status).toBe(201);
  return json<{ id: string; version: number }>(response);
}
async function makeLot(
  pointId: string,
  commercialCode: string,
  lotNumber: string,
  expiration: string,
) {
  return (
    await db.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date) values ($1,$2,$3,$4) returning id`,
      [commercialCode, pointId, lotNumber, expiration],
    )
  ).rows[0]!.id;
}
async function seedLot(lotId: string, quantity: number) {
  await db.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'ADJUSTMENT',$2,'TRANSFER_LINE',$3,now(),$4)`,
    [lotId, quantity, randomUUID(), userId],
  );
}
async function transferFor(
  sourceId: string,
  destinationId: string,
  lotId: string,
  quantity: number,
) {
  const response = await api('POST', '/inventory/transfers', {
    sourceDispensingPointId: sourceId,
    destinationDispensingPointId: destinationId,
    lines: [{ sourceInventoryLotId: lotId, quantity }],
  });
  expect(response.status).toBe(201);
  return json<{ id: string; version: number }>(response);
}
describe('Gate ESP-009 - stock transfers', () => {
  beforeAll(async () => {
    await db.connect();
    connected = true;
    admin = await adminLogin();
    ({ medicarteToken: token } = await ensureOperatorTokens());
    userId = (
      await db.query<{ id: string }>(`select id from users where username='foundation-admin'`)
    ).rows[0]!.id;
    source = (
      await db.query<{ id: string }>(
        `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
        [ORGANIZATION_IDS.MEDICARTE, `${prefix}-SOURCE`, userId],
      )
    ).rows[0]!.id;
    destination = (
      await db.query<{ id: string }>(
        `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
        [ORGANIZATION_IDS.MEDICARTE, `${prefix}-DEST`, userId],
      )
    ).rows[0]!.id;
    lot = (
      await db.query<{ id: string }>(
        `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date) values ($1,$2,$3,'2099-12-31') returning id`,
        [`${prefix}-PRODUCT`, source, `${prefix}-LOT`],
      )
    ).rows[0]!.id;
    await grantAllPointsToMedicarteOperator(db);
  });
  afterAll(async () => {
    if (!connected) return;
    await db.query(`delete from inventory_movements where inventory_lot_id=$1`, [lot]);
    await db.query(
      `delete from stock_transfer_lines where stock_transfer_id in (select id from stock_transfers where source_dispensing_point_id in ($1,$2))`,
      [source, destination],
    );
    await db.query(`delete from stock_transfers where source_dispensing_point_id in ($1,$2)`, [
      source,
      destination,
    ]);
    await db.query(
      `delete from inventory_movements where inventory_lot_id in (select id from inventory_lots where commercial_code like $1)`,
      [`${prefix}%`],
    );
    await db.query(`delete from inventory_lots where commercial_code like $1`, [`${prefix}%`]);
    await deletePointScopesForPoints(db, [source, destination]);
    await db.query(`delete from dispensing_points where id in ($1,$2)`, [source, destination]);
    await db.end();
  });

  it('has ESP-009 model, snapshots and permissions without patient/planning fields', async () => {
    expect(
      (
        await db.query(
          `select 1 from information_schema.tables where table_name in ('stock_transfers','stock_transfer_lines')`,
        )
      ).rowCount,
    ).toBe(2);
    expect(
      (
        await db.query(
          `select 1 from information_schema.columns where table_name='stock_transfers' and column_name in ('patient_id','authorization_item_id','planning_period_id')`,
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          `select 1 from permissions where code in ('stock_transfers.read','stock_transfers.manage')`,
        )
      ).rowCount,
    ).toBe(2);
  });
  it('creates without movements and dispatches atomically, keeping destination unchanged in transit', async () => {
    await createStock(10);
    const value = await transfer(6);
    const created = await db.query<{ count: number }>(
      `select count(*)::int count from inventory_movements where source_type='TRANSFER_LINE' and source_id in (select id from stock_transfer_lines where stock_transfer_id=$1)`,
      [value.id],
    );
    expect(created.rows[0].count).toBe(0);
    const dispatched = await api('POST', `/inventory/transfers/${value.id}/dispatch`, {
      expectedVersion: value.version,
    });
    expect(dispatched.status).toBe(201);
    const movements = await db.query<{ movement_type: string; quantity_delta: number }>(
      `select movement_type,quantity_delta from inventory_movements where source_type='TRANSFER_LINE' and source_id in (select id from stock_transfer_lines where stock_transfer_id=$1)`,
      [value.id],
    );
    expect(movements.rows).toEqual([{ movement_type: 'TRANSFER_OUT', quantity_delta: -6 }]);
    const destinationBalance = await db.query<{ balance: number }>(
      `select coalesce(sum(m.quantity_delta),0)::int balance from inventory_movements m join inventory_lots l on l.id=m.inventory_lot_id where l.dispensing_point_id=$1`,
      [destination],
    );
    expect(destinationBalance.rows[0].balance).toBe(0);
  });
  it('rejects over-transfer and concurrent dispatch allows only one transfer', async () => {
    const over = await transfer(99);
    const rejected = await api('POST', `/inventory/transfers/${over.id}/dispatch`, {
      expectedVersion: over.version,
    });
    expect(rejected.status).toBe(409);
    await createStock(10);
    const a = await transfer(8);
    const b = await transfer(8);
    const results = await Promise.all([
      api('POST', `/inventory/transfers/${a.id}/dispatch`, { expectedVersion: a.version }),
      api('POST', `/inventory/transfers/${b.id}/dispatch`, { expectedVersion: b.version }),
    ]);
    expect(results.filter((item) => item.status === 201)).toHaveLength(1);
    expect(results.filter((item) => item.status === 409)).toHaveLength(1);
  });
  it('receives idempotently and reuses destination lot', async () => {
    const value = await transfer(1);
    const dispatched = await api('POST', `/inventory/transfers/${value.id}/dispatch`, {
      expectedVersion: value.version,
    });
    const sent = await json<{ version: number }>(dispatched);
    const results = await Promise.all([
      api('POST', `/inventory/transfers/${value.id}/receive`, { expectedVersion: sent.version }),
      api('POST', `/inventory/transfers/${value.id}/receive`, { expectedVersion: sent.version }),
    ]);
    expect(results.every((item) => item.status === 201)).toBe(true);
    const rows = await db.query(
      `select count(distinct l.id)::int lots,count(m.id)::int movements from inventory_lots l join inventory_movements m on m.inventory_lot_id=l.id where l.dispensing_point_id=$1 and l.commercial_code=$2`,
      [destination, `${prefix}-PRODUCT`],
    );
    expect(rows.rows[0]).toEqual({ lots: 1, movements: 1 });
  });
  it('conserves global controlled quantity across dispatch and receive', async () => {
    const code = `${prefix}-CONSERVATION`;
    const sourceLot = await makeLot(source, code, `${prefix}-CLOT`, '2099-12-31');
    const destinationLot = await makeLot(destination, code, `${prefix}-CLOT`, '2099-12-31');
    await seedLot(sourceLot, 10);
    await seedLot(destinationLot, 4);
    const value = await transferFor(source, destination, sourceLot, 6);
    const before = await db.query<{ source: number; destination: number }>(
      `select (select coalesce(sum(quantity_delta),0)::int from inventory_movements where inventory_lot_id=$1) source,(select coalesce(sum(quantity_delta),0)::int from inventory_movements where inventory_lot_id=$2) destination`,
      [sourceLot, destinationLot],
    );
    expect(before.rows[0]).toEqual({ source: 10, destination: 4 });
    const sent = await api('POST', `/inventory/transfers/${value.id}/dispatch`, {
      expectedVersion: value.version,
    });
    const dispatched = await json<{ version: number }>(sent);
    const transit = await db.query<{ source: number; destination: number; transit: number }>(
      `select (select coalesce(sum(quantity_delta),0)::int from inventory_movements where inventory_lot_id=$1) source,(select coalesce(sum(quantity_delta),0)::int from inventory_movements where inventory_lot_id=$2) destination,(select coalesce(sum(quantity),0)::int from stock_transfer_lines l join stock_transfers t on t.id=l.stock_transfer_id where t.status='DISPATCHED' and l.commercial_code=$3) transit`,
      [sourceLot, destinationLot, code],
    );
    expect(transit.rows[0]).toEqual({ source: 4, destination: 4, transit: 6 });
    await api('POST', `/inventory/transfers/${value.id}/receive`, {
      expectedVersion: dispatched.version,
    });
    const after = await db.query<{ source: number; destination: number; transit: number }>(
      `select (select coalesce(sum(quantity_delta),0)::int from inventory_movements where inventory_lot_id=$1) source,(select coalesce(sum(quantity_delta),0)::int from inventory_movements where inventory_lot_id=$2) destination,(select coalesce(sum(quantity),0)::int from stock_transfer_lines l join stock_transfers t on t.id=l.stock_transfer_id where t.status='DISPATCHED' and l.commercial_code=$3) transit`,
      [sourceLot, destinationLot, code],
    );
    expect(after.rows[0]).toEqual({ source: 4, destination: 10, transit: 0 });
  });
  it('creates one destination lot for two concurrent independent receives', async () => {
    const code = `${prefix}-LOT-RACE`;
    const sourceLot = await makeLot(source, code, `${prefix}-RACE`, '2099-12-31');
    await seedLot(sourceLot, 6);
    const a = await transferFor(source, destination, sourceLot, 3);
    const b = await transferFor(source, destination, sourceLot, 3);
    const dispatched = await Promise.all([
      api('POST', `/inventory/transfers/${a.id}/dispatch`, { expectedVersion: a.version }),
      api('POST', `/inventory/transfers/${b.id}/dispatch`, { expectedVersion: b.version }),
    ]);
    const received = await Promise.all(
      dispatched.map(async (response, index) => {
        const value = await json<{ version: number }>(response);
        const id = index === 0 ? a.id : b.id;
        return api('POST', `/inventory/transfers/${id}/receive`, {
          expectedVersion: value.version,
        });
      }),
    );
    expect(received.every((response) => response.status === 201)).toBe(true);
    const rows = await db.query<{ lots: number; movements: number; balance: number }>(
      `select count(distinct l.id)::int lots,count(m.id)::int movements,coalesce(sum(m.quantity_delta),0)::int balance from inventory_lots l join inventory_movements m on m.inventory_lot_id=l.id where l.dispensing_point_id=$1 and l.commercial_code=$2 and l.lot_number=$3`,
      [destination, code, `${prefix}-RACE`],
    );
    expect(rows.rows[0]).toEqual({ lots: 1, movements: 2, balance: 6 });
  });
  it('blocks expired source stock but receives stock that expires in transit', async () => {
    const expiredCode = `${prefix}-EXPIRED`;
    const expiredLot = await makeLot(source, expiredCode, `${prefix}-EXPIRED`, '2000-01-01');
    await seedLot(expiredLot, 1);
    const blocked = await transferFor(source, destination, expiredLot, 1);
    expect(
      (
        await api('POST', `/inventory/transfers/${blocked.id}/dispatch`, {
          expectedVersion: blocked.version,
        })
      ).status,
    ).toBe(409);
    const transitCode = `${prefix}-EXPIRING`;
    const expiringLot = await makeLot(source, transitCode, `${prefix}-EXPIRING`, '2099-12-31');
    await seedLot(expiringLot, 2);
    const value = await transferFor(source, destination, expiringLot, 2);
    const sent = await api('POST', `/inventory/transfers/${value.id}/dispatch`, {
      expectedVersion: value.version,
    });
    const dispatched = await json<{ version: number }>(sent);
    await db.query(
      `update stock_transfer_lines set expiration_date='2000-01-01' where stock_transfer_id=$1`,
      [value.id],
    );
    expect(
      (
        await api('POST', `/inventory/transfers/${value.id}/receive`, {
          expectedVersion: dispatched.version,
        })
      ).status,
    ).toBe(201);
    const list = await json<{ items: Array<{ physicalBalance: number; usableBalance: number }> }>(
      await api('GET', `/inventory?commercialCode=${encodeURIComponent(transitCode)}`),
    );
    expect(list.items.some((item) => item.physicalBalance === 2 && item.usableBalance === 0)).toBe(
      true,
    );
  });
  it('supports cancellation only before dispatch and freezes dispatched transfers', async () => {
    const value = await transfer(1);
    const cancelled = await api('POST', `/inventory/transfers/${value.id}/cancel`, {
      expectedVersion: value.version,
    });
    expect(cancelled.status).toBe(201);
    expect(
      (
        await api('POST', `/inventory/transfers/${value.id}/dispatch`, {
          expectedVersion: value.version,
        })
      ).status,
    ).toBe(409);
    const frozen = await transfer(1);
    const sent = await api('POST', `/inventory/transfers/${frozen.id}/dispatch`, {
      expectedVersion: frozen.version,
    });
    expect(
      (
        await api('PATCH', `/inventory/transfers/${frozen.id}`, {
          expectedVersion: frozen.version,
          sourceDispensingPointId: destination,
          destinationDispensingPointId: source,
          lines: [{ sourceInventoryLotId: lot, quantity: 1 }],
        })
      ).status,
    ).toBe(409);
    expect(sent.status).toBe(201);
  });
  it('denies OLP and Compensar and exposes no RESERVED/application linkage', async () => {
    const olp = await ensureUser({
      adminToken: admin,
      username: `${prefix.toLowerCase()}-olp`,
      displayName: 'ESP009 OLP',
      password: `${prefix}-password`,
      organizationId: ORGANIZATION_IDS.OLP,
      roleCode: 'OLP_OPERATOR',
    });
    const compensar = await ensureUser({
      adminToken: admin,
      username: `${prefix.toLowerCase()}-comp`,
      displayName: 'ESP009 Compensar',
      password: `${prefix}-password`,
      organizationId: ORGANIZATION_IDS.COMPENSAR,
      roleCode: 'COMPENSAR_VIEWER',
    });
    const mtd = await ensureUser({
      adminToken: admin,
      username: `${prefix.toLowerCase()}-mtd`,
      displayName: 'ESP009 MTD',
      password: `${prefix}-password`,
      organizationId: ORGANIZATION_IDS.MTD,
      roleCode: 'MTD_GENERAL',
    });
    expect(
      (await api('GET', '/inventory/transfers', undefined, mtd, ORGANIZATION_IDS.MTD)).status,
    ).toBe(200);
    const mtdTransfer = await transfer(1);
    expect(
      (
        await api(
          'POST',
          `/inventory/transfers/${mtdTransfer.id}/dispatch`,
          { expectedVersion: mtdTransfer.version },
          mtd,
          ORGANIZATION_IDS.MTD,
        )
      ).status,
    ).toBe(403);
    expect(
      (await api('GET', '/inventory/transfers', undefined, olp, ORGANIZATION_IDS.OLP)).status,
    ).toBe(403);
    expect(
      (await api('GET', '/inventory/transfers', undefined, compensar, ORGANIZATION_IDS.COMPENSAR))
        .status,
    ).toBe(403);
    expect(
      (
        await db.query(
          `select 1 from information_schema.columns where table_name in ('stock_transfers','stock_transfer_lines') and column_name in ('patient_id','authorization_item_id','planning_period_id','reserved')`,
        )
      ).rowCount,
    ).toBe(0);
  });
});
