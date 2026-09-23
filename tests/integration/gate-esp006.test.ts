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
const suffix = randomUUID().slice(0, 8).toUpperCase();
const DECLARED_DISPATCH_DATE = '2037-01-14';
let adminToken: string;
let olpToken: string;
let medicarteToken: string;
let userId: string;
let periodId: string;
let pointId: string;
let orderId: string;
let orderLineId: string;

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = olpToken,
  organizationId = ORGANIZATION_IDS.OLP,
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
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return payload as T;
}
async function createDelivery(quantity: number, lot = 'LOT-ESP006', expirationDate = '2036-06-30') {
  return json<{
    id: string;
    version: number;
    status: string;
    lines: Array<{
      quantity: number;
      acceptedQuantity: number;
      dispatchedQuantity: number;
      remainingQuantity: number;
    }>;
  }>(
    await api('POST', '/supplier/deliveries', {
      purchaseOrderId: orderId,
      supplierReference: `REF-${randomUUID()}`,
      lines: [{ purchaseOrderLineId: orderLineId, quantity, lotNumber: lot, expirationDate }],
    }),
  );
}

describe('Gate ESP-006 - supplier deliveries', () => {
  beforeAll(async () => {
    await database.connect();
    adminToken = await adminLogin();
    ({ olpToken, medicarteToken } = await ensureOperatorTokens());
    const user = await database.query<{ id: string }>('select id from users where username = $1', [
      'foundation-admin',
    ]);
    userId = user.rows[0]!.id;
    const period = await database.query<{ id: string }>(
      `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2037-01-01','2037-01-31','2036-12-01T00:00:00Z','2036-12-10T00:00:00Z','2037-01-15',$1,$1) returning id`,
      [userId],
    );
    periodId = period.rows[0]!.id;
    const point = await database.query<{ id: string }>(
      'insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id',
      [ORGANIZATION_IDS.MTD, `ESP6-POINT-${suffix}`, userId],
    );
    pointId = point.rows[0]!.id;
    const product = `ESP6-${suffix}`;
    await database.query(
      `insert into tariff_annex_products (codigo_producto,tarifa_unidad,descripcion_generica,consecutivo_invima_presentacion,organization_id,created_by) values ($1,'10.00','ESP006 product','ESP006 presentation',$2,$3)`,
      [product, ORGANIZATION_IDS.MTD, userId],
    );
    const order = await database.query<{ id: string }>(
      `insert into purchase_orders (purchase_order_code,planning_period_id,order_type,status,created_by,updated_by) values ($1,$2,'STANDARD','ACCEPTED',$3,$3) returning id`,
      [`OC-ESP6-${suffix}`, periodId, userId],
    );
    orderId = order.rows[0]!.id;
    const line = await database.query<{ id: string }>(
      `insert into purchase_order_lines (purchase_order_id,commercial_code,product_description,presentation,dispensing_point_id,requested_quantity,accepted_quantity,requested_delivery_date,compensar_unit_rate_snapshot,supplier_unit_cost,projected_demand_line_id,projected_demand_revision,demand_bucket) values ($1,$2,'ESP006 product','ESP006 presentation',$3,20,20,'2037-01-15','10.00','10.00',$4,1,'REGULAR') returning id`,
      [orderId, product, pointId, randomUUID()],
    );
    orderLineId = line.rows[0]!.id;
    await grantAllPointsToMedicarteOperator(database);
  });
  afterAll(async () => {
    await database.query(
      'delete from delivery_lines where delivery_id in (select id from deliveries where purchase_order_id = $1)',
      [orderId],
    );
    await database.query('delete from deliveries where purchase_order_id = $1', [orderId]);
    await database.query('delete from purchase_order_lines where purchase_order_id = $1', [
      orderId,
    ]);
    await database.query('delete from purchase_orders where id = $1', [orderId]);
    await database.query('delete from tariff_annex_products where codigo_producto = $1', [
      `ESP6-${suffix}`,
    ]);
    await deletePointScopesForPoints(database, [pointId]);
    await database.query('delete from dispensing_points where id = $1', [pointId]);
    await database.query('delete from planning_periods where id = $1', [periodId]);
    await database.end();
  });

  it('creates DRAFT deliveries, requires lot and expiration, and exposes remaining', async () => {
    const draft = await createDelivery(8);
    expect(draft).toMatchObject({
      status: 'DRAFT',
      lines: [{ quantity: 8, acceptedQuantity: 20, dispatchedQuantity: 0, remainingQuantity: 20 }],
    });
    const invalid = await api('POST', '/supplier/deliveries', {
      purchaseOrderId: orderId,
      lines: [{ purchaseOrderLineId: orderLineId, quantity: 1 }],
    });
    expect(invalid.status).toBe(400);
    const cancelled = await json<{ status: string }>(
      await api('POST', `/supplier/deliveries/${draft.id}/cancel`, {
        expectedVersion: draft.version,
      }),
    );
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('dispatches multiple lots partially and derives PO fulfillment status', async () => {
    const first = await createDelivery(12, 'LOT-A');
    const dispatched = await json<{
      status: string;
      version: number;
      lines: Array<{ dispatchedQuantity: number; remainingQuantity: number }>;
    }>(
      await api('POST', `/supplier/deliveries/${first.id}/dispatch`, {
        expectedVersion: first.version,
        declaredDispatchDate: DECLARED_DISPATCH_DATE,
      }),
    );
    expect(dispatched).toMatchObject({
      status: 'DISPATCHED',
      lines: [{ dispatchedQuantity: 12, remainingQuantity: 8 }],
    });
    const second = await createDelivery(8, 'LOT-B');
    const complete = await json<{ status: string }>(
      await api('POST', `/supplier/deliveries/${second.id}/dispatch`, {
        expectedVersion: second.version,
      }),
    );
    expect(complete.status).toBe('DISPATCHED');
    const order = await json<{ status: string }>(
      await api('GET', `/purchase-orders/${orderId}`, undefined, adminToken, ORGANIZATION_IDS.MTD),
    );
    expect(order.status).toBe('FULLY_DISPATCHED');
    expect(
      (
        await api('POST', `/supplier/deliveries/${first.id}/cancel`, {
          expectedVersion: dispatched.version,
        })
      ).status,
    ).toBe(409);
  });

  it('prevents concurrent dispatches from exceeding accepted quantity', async () => {
    await database.query("update purchase_orders set status = 'IN_FULFILLMENT' where id = $1", [
      orderId,
    ]);
    await database.query(
      'delete from delivery_lines where delivery_id in (select id from deliveries where purchase_order_id = $1)',
      [orderId],
    );
    await database.query('delete from deliveries where purchase_order_id = $1', [orderId]);
    const first = await createDelivery(10, 'LOT-C');
    await json(
      await api('POST', `/supplier/deliveries/${first.id}/dispatch`, {
        expectedVersion: first.version,
        declaredDispatchDate: DECLARED_DISPATCH_DATE,
      }),
    );
    const one = await createDelivery(10, 'LOT-D');
    const two = await createDelivery(10, 'LOT-E');
    const responses = await Promise.all(
      [one, two].map((delivery) =>
        api('POST', `/supplier/deliveries/${delivery.id}/dispatch`, {
          expectedVersion: delivery.version,
          declaredDispatchDate: DECLARED_DISPATCH_DATE,
        }),
      ),
    );
    expect(responses.filter((response) => response.ok).length).toBe(1);
    const total = await database.query<{ quantity: number }>(
      `select coalesce(sum(dl.quantity),0)::int quantity from delivery_lines dl join deliveries d on d.id = dl.delivery_id where d.purchase_order_id = $1 and d.status = 'DISPATCHED'`,
      [orderId],
    );
    expect(total.rows[0]!.quantity).toBe(20);
  });

  it('separates OLP and Medicarte RBAC and exposes no prices or PHI', async () => {
    const response = await api(
      'GET',
      '/medicarte/deliveries',
      undefined,
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    const payload = await json<{ items: Array<Record<string, unknown>> }>(response);
    expect(payload.items[0]).not.toHaveProperty('supplierUnitCost');
    expect(payload.items[0]).not.toHaveProperty('patientDocument');
    expect(
      (await api('GET', '/supplier/deliveries', undefined, adminToken, ORGANIZATION_IDS.COMPENSAR))
        .status,
    ).toBe(403);
  });

  it('does not create inventory movements or transfer tables', async () => {
    const tables = await database.query<{ count: string }>(
      `select count(*)::text count from information_schema.tables where table_schema = 'public' and table_name in ('inventory_lots','inventory_movements')`,
    );
    expect(tables.rows[0]!.count).toBe('2');
    expect(
      (
        await database.query<{ count: number }>(
          `select count(*)::int count from inventory_movements where movement_type <> 'RECEIPT' and source_type <> 'TRANSFER_LINE'`,
        )
      ).rows[0]!.count,
    ).toBe(0);
  });
});
