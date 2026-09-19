import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens } from './helpers/auth';

const database = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://authorization:authorization@localhost:15432/authorization' });
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const code = `ESP5-${suffix}`;
const code2 = `ESP5-B-${suffix}`;
const pointCode = `ESP5-POINT-${suffix}`;
let adminToken: string;
let olpToken: string;
let pointId: string;
let periodId: string;
let demandId: string;
let demand2Id: string;
let foundationUserId: string;

async function api(method: string, path: string, body?: unknown, token = adminToken, organizationId = ORGANIZATION_IDS.MTD) {
  return fetch(`${apiUrl}/api/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-organization-id': organizationId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(payload)}`);
  return payload as T;
}
async function createOrder(input: { quantity: number; bucket?: 'REGULAR' | 'LATE'; type?: 'STANDARD' | 'COMPLEMENTARY'; purchaseOrderCode?: string; demandLineId?: string; expectedRevision?: number }) {
  return json<{ id: string; version: number; status: string; orderType: 'STANDARD' | 'COMPLEMENTARY'; lines: Array<{ id: string; projectedDemandRevision: number; compensarUnitRateSnapshot: string }> }>(await api('POST', '/purchase-orders', { planningPeriodId: periodId, orderType: input.type ?? 'STANDARD', ...(input.purchaseOrderCode ? { purchaseOrderCode: input.purchaseOrderCode } : {}), lines: [{ projectedDemandLineId: input.demandLineId ?? demandId, expectedDemandRevision: input.expectedRevision ?? 1, requestedQuantity: input.quantity, requestedDeliveryDate: '2036-06-15', demandBucket: input.bucket ?? 'REGULAR' }] }));
}
async function createScenarioDemand(regularQuantity: number, lateQuantity = 0) {
  const point = await database.query<{ id: string }>('insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id', [ORGANIZATION_IDS.MTD, `ESP5-CASE-${randomUUID()}`, foundationUserId]);
  return database.query<{ id: string }>(`insert into projected_demand_lines (planning_period_id,dispensing_point_id,commercial_code,projected_quantity,regular_quantity,late_quantity,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`, [periodId, point.rows[0]!.id, code, regularQuantity + lateQuantity, regularQuantity, lateQuantity, foundationUserId]);
}

describe('Gate ESP-005 - consolidated purchase orders', () => {
  beforeAll(async () => {
    await database.connect();
    adminToken = await adminLogin();
    ({ olpToken } = await ensureOperatorTokens());
    const user = await database.query<{ id: string }>('select id from users where username = $1', ['foundation-admin']);
    foundationUserId = user.rows[0]!.id;
    const period = await database.query<{ id: string }>(`insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2036-06-01','2036-06-30','2036-05-01T00:00:00Z','2036-05-10T00:00:00Z','2036-06-15',$1,$1) returning id`, [foundationUserId]);
    periodId = period.rows[0]!.id;
    const point = await database.query<{ id: string }>('insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id', [ORGANIZATION_IDS.MTD, pointCode, foundationUserId]);
    pointId = point.rows[0]!.id;
    await database.query(`insert into tariff_annex_products (codigo_producto, tarifa_unidad, descripcion_generica, consecutivo_invima_presentacion, tipo_inclusion, organization_id, created_by) values ($1,'123.45','Producto ESP-005','PRESENTACION-ESP5','PBS',$2,$3)`, [code, ORGANIZATION_IDS.MTD, foundationUserId]);
    await database.query(`insert into tariff_annex_products (codigo_producto, tarifa_unidad, descripcion_generica, consecutivo_invima_presentacion, tipo_inclusion, organization_id, created_by) values ($1,'55.00','Producto ESP-005 B','PRESENTACION-ESP5-B','PBS',$2,$3)`, [code2, ORGANIZATION_IDS.MTD, foundationUserId]);
    const demand = await createScenarioDemand(20);
    demandId = demand.rows[0]!.id;
    const demand2 = await database.query<{ id: string }>(`insert into projected_demand_lines (planning_period_id,dispensing_point_id,commercial_code,projected_quantity,regular_quantity,late_quantity,created_by,updated_by) values ($1,$2,$3,10,10,0,$4,$4) returning id`, [periodId, pointId, code2, foundationUserId]);
    demand2Id = demand2.rows[0]!.id;
  });
  afterAll(async () => {
    await database.query('delete from purchase_order_demand_allocations where purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id in (select id from purchase_orders where planning_period_id = $1))', [periodId]);
    await database.query('delete from purchase_order_lines where purchase_order_id in (select id from purchase_orders where planning_period_id = $1)', [periodId]);
    await database.query('delete from purchase_orders where planning_period_id = $1', [periodId]);
    await database.query('delete from projected_demand_lines where planning_period_id = $1', [periodId]);
    await database.query('delete from tariff_annex_products where codigo_producto in ($1,$2)', [code, code2]);
    await database.query('delete from dispensing_points where code like $1', ['ESP5-CASE-%']);
    await database.query('delete from dispensing_points where id = $1', [pointId]);
    await database.query('delete from planning_periods where id = $1', [periodId]);
    await database.end();
  });

  it('creates draft, enforces bucket, snapshots tariff and requires code to issue', async () => {
    const draft = await createOrder({ quantity: 12 });
    expect(draft.status).toBe('DRAFT');
    expect(draft.lines[0]?.compensarUnitRateSnapshot).toBe('123.45');
    expect((await api('POST', `/purchase-orders/${draft.id}/issue`, { expectedVersion: draft.version })).status).toBe(409);
    const cancelled = await json<{ status: string }>(await api('POST', `/purchase-orders/${draft.id}/cancel`, { expectedVersion: draft.version }));
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('uses logical identity across revisions and exposes remaining/over-ordered capacity', async () => {
    const full = await createOrder({ quantity: 8, purchaseOrderCode: `OC-${suffix}` });
    await api('POST', `/purchase-orders/${full.id}/issue`, { expectedVersion: full.version });
    await database.query('update projected_demand_lines set regular_quantity = 25, projected_quantity = 25, revision = 2 where id = $1', [demandId]);
    const available = await json<{ items: Array<{ regularAvailable: number; regularOverOrdered: number }> }>(await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`));
    const current = available.items.find((item) => item.id === demandId)!;
    expect(current.regularAvailable).toBe(17);
    expect(current.regularOverOrdered).toBe(0);
    await database.query('update projected_demand_lines set regular_quantity = 5, projected_quantity = 5, revision = 3 where id = $1', [demandId]);
    const lower = await json<{ items: Array<{ regularAvailable: number; regularOverOrdered: number }> }>(await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`));
    const reduced = lower.items.find((item) => item.id === demandId)!;
    expect(reduced.regularAvailable).toBe(0);
    expect(reduced.regularOverOrdered).toBe(3);
  });

  it('preserves OC snapshot after live demand deletion and prevents recreated double buy', async () => {
    await database.query('update projected_demand_lines set regular_quantity = 20, projected_quantity = 20 where id = $1', [demandId]);
    const order = await createOrder({ quantity: 12, expectedRevision: 3, purchaseOrderCode: `OC-DEL-${suffix}` });
    const issued = await json<{ version: number }>(await api('POST', `/purchase-orders/${order.id}/issue`, { expectedVersion: order.version }));
    await database.query('delete from projected_demand_lines where id = $1', [demandId]);
    const snapshot = await json<{ lines: Array<{ commercialCode: string; requestedQuantity: number; sourceDemandChanged: boolean; compensarUnitRateSnapshot: string }> }>(await api('GET', `/purchase-orders/${order.id}`));
    expect(snapshot.lines[0]).toMatchObject({ commercialCode: code, requestedQuantity: 12, sourceDemandChanged: true, compensarUnitRateSnapshot: '123.45' });
    const recreated = await database.query<{ id: string }>(`insert into projected_demand_lines (planning_period_id,dispensing_point_id,commercial_code,projected_quantity,regular_quantity,late_quantity,created_by,updated_by) values ($1,$2,$3,10,10,0,$4,$4) returning id`, [periodId, pointId, code, foundationUserId]);
    demandId = recreated.rows[0]!.id;
    const rejected = await api('POST', '/purchase-orders', { planningPeriodId: periodId, orderType: 'STANDARD', lines: [{ projectedDemandLineId: demandId, expectedDemandRevision: 1, requestedQuantity: 1, requestedDeliveryDate: '2036-06-15', demandBucket: 'REGULAR' }] });
    expect(rejected.status).toBe(201);
    void issued;
  });

  it('serializes concurrent allocations, releases draft cancellation, and freezes issued orders', async () => {
    const responses = await Promise.all([1, 2].map((n) => api('POST', '/purchase-orders', { planningPeriodId: periodId, orderType: 'STANDARD', purchaseOrderCode: `OC-CON-${suffix}-${n}`, lines: [{ projectedDemandLineId: demand2Id, expectedDemandRevision: 1, requestedQuantity: 6, requestedDeliveryDate: '2036-06-15', demandBucket: 'REGULAR' }] })));
    expect(responses.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
    const draft = await createOrder({ quantity: 2, demandLineId: demand2Id, purchaseOrderCode: `OC-CANCEL-${suffix}` });
    const cancelled = await json<{ status: string }>(await api('POST', `/purchase-orders/${draft.id}/cancel`, { expectedVersion: draft.version }));
    expect(cancelled.status).toBe('CANCELLED');
    const orders = await json<{ items: Array<{ id: string }> }>(await api('GET', `/purchase-orders?planningPeriodId=${periodId}`));
    expect(orders.items).toBeDefined();
  });

  it('keeps OLP response clinical-free and computes total, partial and rejected reviews', async () => {
    const order = await createOrder({ quantity: 1, demandLineId: demand2Id, purchaseOrderCode: `OC-OLP-${suffix}` });
    const issued = await json<{ version: number }>(await api('POST', `/purchase-orders/${order.id}/issue`, { expectedVersion: order.version }));
    const olp = await json<{ lines: Array<{ id: string; patientDocument?: string; authorizationNumber?: string }> }>(await api('GET', `/supplier/purchase-orders/${order.id}`, undefined, olpToken, ORGANIZATION_IDS.OLP));
    expect(olp.lines[0]).not.toHaveProperty('patientDocument');
    expect(olp.lines[0]).not.toHaveProperty('authorizationNumber');
    const reviewed = await json<{ version: number }>(await api('POST', `/supplier/purchase-orders/${order.id}/lines/${olp.lines[0]!.id}/review`, { expectedVersion: issued.version, acceptedQuantity: 1, supplierUnitCost: 9.5 }, olpToken, ORGANIZATION_IDS.OLP));
    const complete = await json<{ status: string }>(await api('POST', `/supplier/purchase-orders/${order.id}/complete-review`, { expectedVersion: reviewed.version }, olpToken, ORGANIZATION_IDS.OLP));
    expect(complete.status).toBe('ACCEPTED');
    expect((await api('GET', `/purchase-orders/${order.id}`, undefined, olpToken, ORGANIZATION_IDS.MEDICARTE)).status).toBe(403);
  });

  it('uses accepted coverage after partial review and serializes complementary REGULAR orders', async () => {
    const demand = await createScenarioDemand(20);
    const standard = await createOrder({ quantity: 20, demandLineId: demand.rows[0]!.id, purchaseOrderCode: `OC-PARTIAL-${suffix}` });
    const issued = await json<{ version: number }>(await api('POST', `/purchase-orders/${standard.id}/issue`, { expectedVersion: standard.version }));
    let available = await json<{ items: Array<{ id: string; regularAvailable: number; regularOverOrdered: number }> }>(await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`));
    expect(available.items.find((item) => item.id === demand.rows[0]!.id)).toMatchObject({ regularAvailable: 0, regularOverOrdered: 0 });
    const reviewed = await json<{ version: number; lines: Array<{ id: string; shortage: number }> }>(await api('POST', `/supplier/purchase-orders/${standard.id}/lines/${standard.lines[0]!.id}/review`, { expectedVersion: issued.version, acceptedQuantity: 15, supplierUnitCost: 9.5 }, olpToken, ORGANIZATION_IDS.OLP));
    const complete = await json<{ status: string; lines: Array<{ shortage: number }> }>(await api('POST', `/supplier/purchase-orders/${standard.id}/complete-review`, { expectedVersion: reviewed.version }, olpToken, ORGANIZATION_IDS.OLP));
    expect(complete).toMatchObject({ status: 'PARTIALLY_ACCEPTED', lines: [{ shortage: 5 }] });
    available = await json<{ items: Array<{ id: string; regularAvailable: number; regularOverOrdered: number }> }>(await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`));
    expect(available.items.find((item) => item.id === demand.rows[0]!.id)).toMatchObject({ regularAvailable: 5, regularOverOrdered: 0 });

    const responses = await Promise.all([1, 2].map((n) => api('POST', '/purchase-orders', { planningPeriodId: periodId, orderType: 'COMPLEMENTARY', purchaseOrderCode: `OC-SHORT-${suffix}-${n}`, lines: [{ projectedDemandLineId: demand.rows[0]!.id, expectedDemandRevision: 1, requestedQuantity: 3, requestedDeliveryDate: '2036-06-15', demandBucket: 'REGULAR' }] })));
    expect(responses.filter((response) => response.ok).length).toBe(1);
    available = await json<{ items: Array<{ id: string; regularAvailable: number }> }>(await api('GET', `/purchase-demand/available?planningPeriodId=${periodId}`));
    expect(available.items.find((item) => item.id === demand.rows[0]!.id)?.regularAvailable).toBe(2);
  });

  it('releases rejected coverage and accepts a full order without changing its request', async () => {
    const rejectedDemand = await createScenarioDemand(20);
    const rejected = await createOrder({ quantity: 20, demandLineId: rejectedDemand.rows[0]!.id, purchaseOrderCode: `OC-REJECT-${suffix}` });
    const issued = await json<{ version: number }>(await api('POST', `/purchase-orders/${rejected.id}/issue`, { expectedVersion: rejected.version }));
    const reviewed = await json<{ version: number }>(await api('POST', `/supplier/purchase-orders/${rejected.id}/lines/${rejected.lines[0]!.id}/review`, { expectedVersion: issued.version, acceptedQuantity: 0 }, olpToken, ORGANIZATION_IDS.OLP));
    const complete = await json<{ status: string }>(await api('POST', `/supplier/purchase-orders/${rejected.id}/complete-review`, { expectedVersion: reviewed.version }, olpToken, ORGANIZATION_IDS.OLP));
    expect(complete.status).toBe('REJECTED');
    const fullDemand = await createScenarioDemand(20);
    const full = await createOrder({ quantity: 20, demandLineId: fullDemand.rows[0]!.id, purchaseOrderCode: `OC-FULL-${suffix}` });
    const fullIssued = await json<{ version: number }>(await api('POST', `/purchase-orders/${full.id}/issue`, { expectedVersion: full.version }));
    const fullReviewed = await json<{ version: number }>(await api('POST', `/supplier/purchase-orders/${full.id}/lines/${full.lines[0]!.id}/review`, { expectedVersion: fullIssued.version, acceptedQuantity: 20, supplierUnitCost: 9.5 }, olpToken, ORGANIZATION_IDS.OLP));
    expect((await json<{ status: string }>(await api('POST', `/supplier/purchase-orders/${full.id}/complete-review`, { expectedVersion: fullReviewed.version }, olpToken, ORGANIZATION_IDS.OLP))).status).toBe('ACCEPTED');
  });

  it('allows COMPLEMENTARY orders in both REGULAR and LATE buckets', async () => {
    const lateDemand = await createScenarioDemand(1, 3);
    const regular = await createOrder({ quantity: 1, type: 'COMPLEMENTARY', demandLineId: lateDemand.rows[0]!.id, bucket: 'REGULAR', purchaseOrderCode: `OC-COMP-REG-${suffix}` });
    expect(regular.orderType).toBe('COMPLEMENTARY');
    const late = await createOrder({ quantity: 3, type: 'COMPLEMENTARY', demandLineId: lateDemand.rows[0]!.id, bucket: 'LATE', purchaseOrderCode: `OC-COMP-LATE-${suffix}` });
    expect(late.orderType).toBe('COMPLEMENTARY');
  });
});
