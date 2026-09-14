import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens, ensureUser } from './helpers/auth';

const db = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization',
});
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const product = `ESP013-PRODUCT-${suffix}`;
const missingProduct = `ESP013-NONE-${suffix}`;
const coverageProduct = `ESP013-COV-${suffix}`;
const historicalProduct = `ESP013-HIST-${suffix}`;
let adminToken = '';
let medicarteToken = '';
let olpToken = '';
let compensarToken = '';
let mtdToken = '';
let userId = '';
let periodId = '';
let periodCreated = false;
let historicalPeriodId = '';
let historicalPeriodCreated = false;
let pointId = '';
let otherPointId = '';
let acceptedOrderId = '';
let acceptedOrderUpdatedAt = '';
const scheduleIds: string[] = [];
const authIds: string[] = [];
const batchIds: string[] = [];
const lotIds: string[] = [];
const applicationIds: string[] = [];
const orderIds: string[] = [];
const deliveryIds: string[] = [];
const receiptIds: string[] = [];
const transferIds: string[] = [];

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = adminToken,
  organizationId = ORGANIZATION_IDS.MTD,
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
type Ratio = { numerator: number; denominator: number; rate: string | null };
type Money = {
  availability: string;
  value: string | null;
  reason: string | null;
  basis: string | null;
};
type Analytics = {
  demand: {
    regularProjectedQuantity: number;
    lateProjectedQuantity: number;
    projectedQuantity: number;
    lastConsolidatedAt: string | null;
    stale: boolean;
  };
  procurement: {
    requestedQuantity: number;
    acceptedQuantity: number;
    supplierShortageQuantity: number;
    effectivePurchaseCoverage: number;
    procurementGapQuantity: number;
    purchaseCoverageRate: Ratio;
    supplierAcceptanceRate: Ratio;
  };
  delivery: {
    dispatchedQuantity: number;
    dispatchFulfillmentRate: Ratio;
  };
  receipt: {
    physicallyReceivedQuantity: number;
    acceptedIntoInventoryQuantity: number;
    rejectedQuantity: number;
    receiptPhysicalShortageQuantity: number;
    receiptAcceptanceRate: Ratio;
  };
  application: { appliedQuantity: number; applicationRate: Ratio };
  inventory: {
    currentOnHandQuantity: number;
    usableBalance: number;
    inTransitQuantity: number;
    nonReusableQuantity: number;
    receivedMinusAppliedFlow: { value: number; label: string; disclaimer: string };
  };
  outcomes: {
    notAppliedCount: number;
    noShowRate: Ratio;
    distribution: Array<{ noveltyCode: string; count: number }>;
  };
  audit: {
    readyForAudit: number;
    inReview: number;
    approved: number;
    rejected: number;
  };
  economics: {
    compensar: {
      projectedTariffReferenceValue: Money;
      requestedTariffSnapshotValue: Money;
      acceptedTariffSnapshotValue: Money;
    };
    olp: {
      acceptedSupplierValue: Money;
      dispatchedSupplierValue: Money;
      acceptedReceiptSupplierValue: Money;
      appliedSupplierCost: Money;
    };
  } | null;
  funnel: { requestedQuantity: number };
};
async function analytics(query: Record<string, string> = {}, token = adminToken) {
  const params = new URLSearchParams({
    planningPeriodId: periodId,
    dispensingPointId: pointId,
    commercialCode: product,
    ...query,
  });
  return json<Analytics>(await api('GET', `/analytics/operational?${params}`, undefined, token));
}
async function insertAuth(code = product) {
  const number = `ESP013-AUTH-${randomUUID()}`;
  const batch = (
    await db.query<{ id: string }>(
      `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at) values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
      [ORGANIZATION_IDS.MTD, userId, `${number}.json`, 'a'.repeat(64)],
    )
  ).rows[0]!.id;
  batchIds.push(batch);
  const auth = (
    await db.query<{ id: string }>(
      `insert into authorization_items (numero_autorizacion,codigo_medicamento,authorization_key,source_data,source_status_normalized,source_prescripcion_normalized,no_prescripcion,enablement_status,coverage_type,direction_status,coverage_rule_version,created_from_batch_id) values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP013',$5) returning id`,
      [
        number,
        code,
        `${number}:${code}`,
        JSON.stringify({
          IDENTIFICACION_PACIENTE: `DOC-${suffix}`,
          NOMBRE_PACIENTE: 'Paciente ESP-013',
          CANTIDAD: '1',
          FECHA_FINAL_VIGENCIA: '2099-12-31',
        }),
        batch,
      ],
    )
  ).rows[0]!.id;
  authIds.push(auth);
  await db.query(
    `insert into authorization_item_organizations (authorization_item_id,organization_id) values ($1,$2)`,
    [auth, ORGANIZATION_IDS.MEDICARTE],
  );
  return auth;
}
async function insertSchedule(auth: string, quantity = 1) {
  const schedule = (
    await db.query<{ id: string }>(
      `insert into patient_schedules (authorization_item_id,planning_period_id,dispensing_point_id,commercial_code,scheduled_date,quantity,created_by,updated_by) values ($1,$2,$3,$4,'2043-03-15',$5,$6,$6) returning id`,
      [auth, periodId, pointId, product, quantity, userId],
    )
  ).rows[0]!.id;
  scheduleIds.push(schedule);
  return schedule;
}
async function insertOrder(input: {
  status: string;
  requested: number;
  accepted: number | null;
  code: string;
  cost?: string | null;
  commercialCode?: string;
  planningPeriodId?: string;
  tariffSnapshot?: string;
}) {
  const id = randomUUID();
  orderIds.push(id);
  const orderPeriodId = input.planningPeriodId ?? periodId;
  const commercialCode = input.commercialCode ?? product;
  await db.query(
    `insert into purchase_orders (id,purchase_order_code,planning_period_id,order_type,status,created_by,updated_by) values ($1,$2,$3,'STANDARD',$4,$5,$5)`,
    [id, input.code, orderPeriodId, input.status, userId],
  );
  const line = (
    await db.query<{ id: string }>(
      `insert into purchase_order_lines (purchase_order_id,commercial_code,product_description,presentation,dispensing_point_id,requested_quantity,accepted_quantity,requested_delivery_date,compensar_unit_rate_snapshot,supplier_unit_cost,projected_demand_line_id,projected_demand_revision,demand_bucket) values ($1,$2,'ESP013','presentation',$3,$4,$5,'2043-03-20',$6,$7,$8,1,'REGULAR') returning id`,
      [
        id,
        commercialCode,
        pointId,
        input.requested,
        input.accepted,
        input.tariffSnapshot ?? '20.00',
        input.cost === undefined ? '10.00' : input.cost,
        randomUUID(),
      ],
    )
  ).rows[0]!.id;
  return { id, lineId: line };
}

beforeAll(async () => {
  await db.connect();
  const admin = await db.query<{ id: string }>(
    `select id from users where username='foundation-admin'`,
  );
  userId = admin.rows[0]!.id;
  adminToken = await adminLogin();
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  mtdToken = await ensureUser({
    adminToken,
    username: `esp013-mtd-${suffix}`,
    displayName: 'ESP013 MTD',
    password: `esp013-mtd-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp013-comp-${suffix}`,
    displayName: 'ESP013 Compensar',
    password: `esp013-comp-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  const existingPeriod = await db.query<{ id: string }>(
    `select id from planning_periods where start_date='2043-03-01' and end_date='2043-03-31' limit 1`,
  );
  periodId =
    existingPeriod.rows[0]?.id ??
    (
      await db.query<{ id: string }>(
        `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2043-03-01','2043-03-31','2042-01-01T00:00:00Z','2042-01-02T00:00:00Z','2043-03-20',$1,$1) returning id`,
        [userId],
      )
    ).rows[0]!.id;
  periodCreated = existingPeriod.rows.length === 0;
  pointId = (
    await db.query<{ id: string }>(
      `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `ESP013-A-${suffix}`, userId],
    )
  ).rows[0]!.id;
  otherPointId = (
    await db.query<{ id: string }>(
      `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `ESP013-B-${suffix}`, userId],
    )
  ).rows[0]!.id;
  await db.query(
    `insert into tariff_annex_products (codigo_producto,tarifa_unidad,descripcion_generica,consecutivo_invima_presentacion,organization_id,created_by) values ($1,'20.00','Producto ESP-013','PRESENTACION-ESP013',$2,$3)`,
    [product, ORGANIZATION_IDS.MTD, userId],
  );
  const demand = (
    await db.query<{ id: string }>(
      `insert into projected_demand_lines (planning_period_id,dispensing_point_id,commercial_code,projected_quantity,regular_quantity,late_quantity,consolidated_at,created_by,updated_by) values ($1,$2,$3,24,20,4,now(),$4,$4) returning id`,
      [periodId, pointId, product, userId],
    )
  ).rows[0]!.id;
  const accepted = await insertOrder({
    status: 'ACCEPTED',
    requested: 18,
    accepted: 15,
    code: `ESP013-ACC-${suffix}`,
  });
  acceptedOrderId = accepted.id;
  acceptedOrderUpdatedAt = (
    await db.query<{ updated_at: string }>(
      `select updated_at::text from purchase_orders where id=$1`,
      [acceptedOrderId],
    )
  ).rows[0]!.updated_at;
  await db.query(
    `insert into purchase_order_demand_allocations (purchase_order_line_id,projected_demand_line_id,projected_demand_revision,demand_bucket,allocated_quantity) values ($1,$2,1,'REGULAR',18)`,
    [accepted.lineId, demand],
  );
  await insertOrder({
    status: 'REJECTED',
    requested: 3,
    accepted: 0,
    code: `ESP013-REJ-${suffix}`,
  });
  await insertOrder({
    status: 'DRAFT',
    requested: 99,
    accepted: null,
    code: `ESP013-DRAFT-${suffix}`,
    cost: null,
  });
  await insertOrder({
    status: 'CANCELLED',
    requested: 40,
    accepted: null,
    code: `ESP013-CAN-${suffix}`,
    cost: null,
  });
  const coverageDemand = (
    await db.query<{ id: string }>(
      `insert into projected_demand_lines (planning_period_id,dispensing_point_id,commercial_code,projected_quantity,regular_quantity,late_quantity,consolidated_at,created_by,updated_by) values ($1,$2,$3,100,100,0,now(),$4,$4) returning id`,
      [periodId, pointId, coverageProduct, userId],
    )
  ).rows[0]!.id;
  const coverageDraft = await insertOrder({
    status: 'DRAFT',
    requested: 100,
    accepted: null,
    code: `ESP013-COV-${suffix}`,
    cost: null,
    commercialCode: coverageProduct,
  });
  await db.query(
    `insert into purchase_order_demand_allocations (purchase_order_line_id,projected_demand_line_id,projected_demand_revision,demand_bucket,allocated_quantity) values ($1,$2,1,'REGULAR',100)`,
    [coverageDraft.lineId, coverageDemand],
  );
  const existingHistoricalPeriod = await db.query<{ id: string }>(
    `select id from planning_periods where start_date='2018-07-01' and end_date='2018-07-31' limit 1`,
  );
  historicalPeriodId =
    existingHistoricalPeriod.rows[0]?.id ??
    (
      await db.query<{ id: string }>(
        `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2018-07-01','2018-07-31','2017-01-01T00:00:00Z','2017-01-02T00:00:00Z','2018-07-20',$1,$1) returning id`,
        [userId],
      )
    ).rows[0]!.id;
  historicalPeriodCreated = existingHistoricalPeriod.rows.length === 0;
  await db.query(
    `insert into tariff_annex_products (codigo_producto,tarifa_unidad,descripcion_generica,consecutivo_invima_presentacion,organization_id,created_by) values ($1,'20.00','Producto ESP-013 histórico','PRESENTACION-ESP013H',$2,$3)`,
    [historicalProduct, ORGANIZATION_IDS.MTD, userId],
  );
  await db.query(
    `insert into projected_demand_lines (planning_period_id,dispensing_point_id,commercial_code,projected_quantity,regular_quantity,late_quantity,consolidated_at,created_by,updated_by) values ($1,$2,$3,10,10,0,now(),$4,$4)`,
    [historicalPeriodId, pointId, historicalProduct, userId],
  );
  await insertOrder({
    status: 'ACCEPTED',
    requested: 8,
    accepted: 8,
    code: `ESP013-HIST-${suffix}`,
    cost: '9.00',
    commercialCode: historicalProduct,
    planningPeriodId: historicalPeriodId,
    tariffSnapshot: '15.00',
  });
  const deliveryId = randomUUID();
  deliveryIds.push(deliveryId);
  await db.query(
    `insert into deliveries (id,purchase_order_id,status,dispatched_at,created_by,updated_by) values ($1,$2,'DISPATCHED',now(),$3,$3)`,
    [deliveryId, acceptedOrderId, userId],
  );
  const deliveryLineId = (
    await db.query<{ id: string }>(
      `insert into delivery_lines (delivery_id,purchase_order_line_id,commercial_code,dispensing_point_id,quantity,lot_number,expiration_date) values ($1,$2,$3,$4,14,$5,'2099-12-31') returning id`,
      [deliveryId, accepted.lineId, product, pointId, `${suffix}-LOT-R`],
    )
  ).rows[0]!.id;
  const receiptId = randomUUID();
  receiptIds.push(receiptId);
  await db.query(
    `insert into receipts (id,delivery_id,status,conformity,received_at,confirmed_at,created_by,updated_by) values ($1,$2,'CONFIRMED','PARTIALLY_CONFORMING',now(),now(),$3,$3)`,
    [receiptId, deliveryId, userId],
  );
  const receiptLineId = (
    await db.query<{ id: string }>(
      `insert into receipt_lines (receipt_id,delivery_line_id,dispatched_quantity,received_quantity,accepted_quantity,rejected_quantity,shortage_quantity,expected_lot_number,expected_expiration_date,received_lot_number,received_expiration_date,conformity) values ($1,$2,14,12,10,2,2,$3,'2099-12-31',$3,'2099-12-31','PARTIALLY_CONFORMING') returning id`,
      [receiptId, deliveryLineId, `${suffix}-LOT-R`],
    )
  ).rows[0]!.id;
  const receiptLot = (
    await db.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date) values ($1,$2,$3,'2099-12-31') returning id`,
      [product, pointId, `${suffix}-LOT-R`],
    )
  ).rows[0]!.id;
  lotIds.push(receiptLot);
  await db.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'RECEIPT',10,'RECEIPT_LINE',$2,now(),$3)`,
    [receiptLot, receiptLineId, userId],
  );
  const transferLot = (
    await db.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date) values ($1,$2,$3,'2099-12-31') returning id`,
      [product, pointId, `${suffix}-LOT-T`],
    )
  ).rows[0]!.id;
  lotIds.push(transferLot);
  await db.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'ADJUSTMENT',8,'ADJUSTMENT',$2,now(),$3)`,
    [transferLot, randomUUID(), userId],
  );
  const transferId = randomUUID();
  transferIds.push(transferId);
  await db.query(
    `insert into stock_transfers (id,source_dispensing_point_id,destination_dispensing_point_id,status,dispatched_at,created_by,updated_by) values ($1,$2,$3,'DISPATCHED',now(),$4,$4)`,
    [transferId, pointId, otherPointId, userId],
  );
  const transferLineId = (
    await db.query<{ id: string }>(
      `insert into stock_transfer_lines (stock_transfer_id,source_inventory_lot_id,commercial_code,lot_number,expiration_date,quantity) values ($1,$2,$3,$4,'2099-12-31',3) returning id`,
      [transferId, transferLot, product, `${suffix}-LOT-T`],
    )
  ).rows[0]!.id;
  await db.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'TRANSFER_OUT',-3,'TRANSFER_LINE',$2,now(),$3)`,
    [transferLot, transferLineId, userId],
  );
  const applicationStatuses: Array<'ready' | 'review' | 'approved' | 'rejected'> = [
    'ready',
    'review',
    'approved',
    'rejected',
  ];
  for (const status of applicationStatuses) {
    const auth = await insertAuth();
    const schedule = await insertSchedule(auth, 1);
    const applicationId = randomUUID();
    applicationIds.push(applicationId);
    await db.query('begin');
    await db.query(
      `insert into patient_applications (id,patient_schedule_id,schedule_revision,authorization_item_id,commercial_code,dispensing_point_id,scheduled_date,application_date,status,confirmed_by,confirmed_at,created_by) values ($1,$2,1,$3,$4,$5,'2043-03-15','2043-03-15','CONFIRMED',$6,now(),$6)`,
      [applicationId, schedule, auth, product, pointId, userId],
    );
    const lineId = (
      await db.query<{ id: string }>(
        `insert into patient_application_lines (patient_application_id,inventory_lot_id,commercial_code,dispensing_point_id,lot_number,expiration_date,quantity) values ($1,$2,$3,$4,$5,'2099-12-31',1) returning id`,
        [applicationId, receiptLot, product, pointId, `${suffix}-LOT-R`],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'APPLICATION',-1,'APPLICATION_LINE',$2,now(),$3)`,
      [receiptLot, lineId, userId],
    );
    if (status !== 'ready') {
      await db.query(
        `insert into patient_application_audits (patient_application_id,application_revision,authorization_item_id,status,started_by,decided_at,decided_by,rejection_code,observation) values ($1,1,$2,$3,$4,$5,$4,$6,$7)`,
        [
          applicationId,
          auth,
          status === 'review' ? 'IN_REVIEW' : status === 'approved' ? 'APPROVED' : 'REJECTED',
          userId,
          status === 'review' ? null : new Date().toISOString(),
          status === 'rejected' ? 'SUPPORT_MISSING' : null,
          null,
        ],
      );
      if (status === 'approved') {
        await db.query(
          `update authorization_items set admission_status='READY', audit_status='APPROVED' where id=$1`,
          [auth],
        );
      } else if (status === 'rejected') {
        await db.query(`update authorization_items set audit_status='REJECTED' where id=$1`, [
          auth,
        ]);
      } else {
        await db.query(`update authorization_items set audit_status='IN_REVIEW' where id=$1`, [
          auth,
        ]);
      }
    }
    await db.query('commit');
  }
  await db.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'NON_REUSABLE',-1,'OUTCOME_LINE',$2,now(),$3)`,
    [receiptLot, randomUUID(), userId],
  );
  for (const novelty of [
    'PATIENT_NO_SHOW',
    'INCORRECT_PRESCRIPTION',
    'INSUFFICIENT_STOCK',
  ] as const) {
    const auth = await insertAuth();
    const schedule = await insertSchedule(auth, 1);
    await db.query(
      `insert into patient_schedule_outcomes (patient_schedule_id,schedule_revision,authorization_item_id,outcome,novelty_code,occurred_on,prepared_product_disposition,created_by) values ($1,1,$2,'NOT_APPLIED',$3,'2043-03-16','NOT_PREPARED',$4)`,
      [schedule, auth, novelty, userId],
    );
  }
});

afterAll(async () => {
  await db.query(
    `alter table patient_application_audits disable trigger patient_application_audits_terminal_immutable`,
  );
  await db.query(
    `alter table patient_applications disable trigger patient_applications_confirmed_immutable`,
  );
  await db.query(
    `alter table patient_application_lines disable trigger patient_application_lines_confirmed_immutable`,
  );
  if (authIds.length)
    await db.query(
      `delete from patient_application_audits where authorization_item_id=any($1::uuid[])`,
      [authIds],
    );
  if (applicationIds.length) {
    await db.query(
      `delete from patient_application_lines where patient_application_id=any($1::uuid[])`,
      [applicationIds],
    );
    await db.query(`delete from patient_applications where id=any($1::uuid[])`, [applicationIds]);
  }
  if (scheduleIds.length) {
    await db.query(
      `delete from patient_schedule_outcome_lines where outcome_id in (select id from patient_schedule_outcomes where patient_schedule_id=any($1::uuid[]))`,
      [scheduleIds],
    );
    await db.query(
      `delete from patient_schedule_outcomes where patient_schedule_id=any($1::uuid[])`,
      [scheduleIds],
    );
    await db.query(`delete from patient_schedules where id=any($1::uuid[])`, [scheduleIds]);
  }
  if (transferIds.length) {
    await db.query(
      `delete from inventory_movements where source_type='TRANSFER_LINE' and source_id in (select id from stock_transfer_lines where stock_transfer_id=any($1::uuid[]))`,
      [transferIds],
    );
    await db.query(`delete from stock_transfer_lines where stock_transfer_id=any($1::uuid[])`, [
      transferIds,
    ]);
    await db.query(`delete from stock_transfers where id=any($1::uuid[])`, [transferIds]);
  }
  if (lotIds.length) {
    await db.query(`delete from inventory_movements where inventory_lot_id=any($1::uuid[])`, [
      lotIds,
    ]);
    await db.query(`delete from inventory_lots where id=any($1::uuid[])`, [lotIds]);
  }
  if (receiptIds.length) {
    await db.query(`delete from receipt_lines where receipt_id=any($1::uuid[])`, [receiptIds]);
    await db.query(`delete from receipts where id=any($1::uuid[])`, [receiptIds]);
  }
  if (deliveryIds.length) {
    await db.query(`delete from delivery_lines where delivery_id=any($1::uuid[])`, [deliveryIds]);
    await db.query(`delete from deliveries where id=any($1::uuid[])`, [deliveryIds]);
  }
  if (orderIds.length) {
    await db.query(
      `delete from purchase_order_demand_allocations where purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id=any($1::uuid[]))`,
      [orderIds],
    );
    await db.query(`delete from purchase_order_lines where purchase_order_id=any($1::uuid[])`, [
      orderIds,
    ]);
    await db.query(`delete from purchase_orders where id=any($1::uuid[])`, [orderIds]);
  }
  await db.query(`delete from projected_demand_lines where commercial_code=any($1::text[])`, [
    [product, coverageProduct, historicalProduct],
  ]);
  await db.query(`delete from tariff_annex_products where codigo_producto=any($1::text[])`, [
    [product, historicalProduct],
  ]);
  if (authIds.length) {
    await db.query(
      `delete from authorization_item_organizations where authorization_item_id=any($1::uuid[])`,
      [authIds],
    );
    await db.query(`delete from authorization_items where id=any($1::uuid[])`, [authIds]);
  }
  if (batchIds.length)
    await db.query(`delete from import_batches where id=any($1::uuid[])`, [batchIds]);
  if (pointId && otherPointId)
    await db.query(`delete from dispensing_points where id in ($1,$2)`, [pointId, otherPointId]);
  if (historicalPeriodCreated)
    await db.query(`delete from planning_periods where id=$1`, [historicalPeriodId]);
  if (periodCreated) await db.query(`delete from planning_periods where id=$1`, [periodId]);
  await db.query(
    `alter table patient_application_lines enable trigger patient_application_lines_confirmed_immutable`,
  );
  await db.query(
    `alter table patient_applications enable trigger patient_applications_confirmed_immutable`,
  );
  await db.query(
    `alter table patient_application_audits enable trigger patient_application_audits_terminal_immutable`,
  );
  await db.end();
});

describe('Gate ESP-013 - operational and economic analytics', () => {
  it('1. projected regular/late/total', async () => {
    const result = await analytics();
    expect(result.demand).toMatchObject({
      regularProjectedQuantity: 20,
      lateProjectedQuantity: 4,
      projectedQuantity: 24,
    });
    expect(result.demand.lastConsolidatedAt).toBeTruthy();
  });

  it('2. requested excludes draft and cancelled', async () => {
    expect((await analytics()).procurement.requestedQuantity).toBe(21);
  });

  it('3. accepted keeps the OLP fact', async () => {
    expect((await analytics()).procurement.acceptedQuantity).toBe(15);
  });

  it('4. supplier shortage is requested minus accepted', async () => {
    expect((await analytics()).procurement.supplierShortageQuantity).toBe(6);
  });

  it('5. dispatched from DISPATCHED deliveries', async () => {
    expect((await analytics()).delivery.dispatchedQuantity).toBe(14);
  });

  it('6. physically received is receipt received_quantity', async () => {
    expect((await analytics()).receipt.physicallyReceivedQuantity).toBe(12);
  });

  it('7. accepted into inventory is distinct from physically received', async () => {
    const result = await analytics();
    expect(result.receipt.acceptedIntoInventoryQuantity).toBe(10);
    expect(result.receipt.acceptedIntoInventoryQuantity).not.toBe(
      result.receipt.physicallyReceivedQuantity,
    );
  });

  it('8. rejected and physical shortage stay separate', async () => {
    const result = await analytics();
    expect(result.receipt.rejectedQuantity).toBe(2);
    expect(result.receipt.receiptPhysicalShortageQuantity).toBe(2);
  });

  it('9. applied comes from confirmed application lines', async () => {
    expect((await analytics()).application.appliedQuantity).toBe(4);
  });

  it('10. non reusable is ledger NON_REUSABLE only', async () => {
    expect((await analytics()).inventory.nonReusableQuantity).toBe(1);
  });

  it('11. physical current inventory is the ledger balance', async () => {
    expect((await analytics()).inventory.currentOnHandQuantity).toBe(10);
  });

  it('12. usable current inventory excludes expired lots', async () => {
    expect((await analytics()).inventory.usableBalance).toBe(10);
  });

  it('13. in transit is dispatched stock transfers', async () => {
    expect((await analytics()).inventory.inTransitQuantity).toBe(3);
  });

  it('14. purchase coverage uses ESP-005 effective coverage', async () => {
    const result = await analytics();
    expect(result.procurement.effectivePurchaseCoverage).toBe(15);
    expect(result.procurement.procurementGapQuantity).toBe(9);
    expect(result.procurement.purchaseCoverageRate).toEqual({
      numerator: 15,
      denominator: 24,
      rate: '0.6250',
    });
  });

  it('15. supplier acceptance rate', async () => {
    expect((await analytics()).procurement.supplierAcceptanceRate).toEqual({
      numerator: 15,
      denominator: 21,
      rate: '0.7142',
    });
  });

  it('16. dispatch fulfillment rate', async () => {
    expect((await analytics()).delivery.dispatchFulfillmentRate).toEqual({
      numerator: 14,
      denominator: 15,
      rate: '0.9333',
    });
  });

  it('17. receipt acceptance rate', async () => {
    expect((await analytics()).receipt.receiptAcceptanceRate).toEqual({
      numerator: 10,
      denominator: 12,
      rate: '0.8333',
    });
  });

  it('18. application rate against materialized projection', async () => {
    expect((await analytics()).application.applicationRate).toEqual({
      numerator: 4,
      denominator: 24,
      rate: '0.1666',
    });
  });

  it('19. denominator zero yields null rates and unavailable money', async () => {
    const result = await analytics({ commercialCode: missingProduct });
    expect(result.procurement.supplierAcceptanceRate.rate).toBeNull();
    expect(result.delivery.dispatchFulfillmentRate.rate).toBeNull();
    expect(result.receipt.receiptAcceptanceRate.rate).toBeNull();
    expect(result.application.applicationRate.rate).toBeNull();
    expect(result.economics?.olp.acceptedSupplierValue).toMatchObject({
      availability: 'UNAVAILABLE',
      value: null,
    });
  });

  it('20. PATIENT_NO_SHOW distribution', async () => {
    const noShow = (await analytics()).outcomes.distribution.find(
      (item) => item.noveltyCode === 'PATIENT_NO_SHOW',
    );
    expect(noShow?.count).toBe(1);
    expect((await analytics()).outcomes.noShowRate).toEqual({
      numerator: 1,
      denominator: 7,
      rate: '0.1428',
    });
  });

  it('21. other novelty distribution', async () => {
    const result = await analytics();
    expect(result.outcomes.notAppliedCount).toBe(3);
    expect(
      result.outcomes.distribution.find((item) => item.noveltyCode === 'INCORRECT_PRESCRIPTION')
        ?.count,
    ).toBe(1);
    expect(
      result.outcomes.distribution.find((item) => item.noveltyCode === 'INSUFFICIENT_STOCK')?.count,
    ).toBe(1);
  });

  it('22. READY_FOR_AUDIT count', async () => {
    expect((await analytics()).audit.readyForAudit).toBe(1);
  });

  it('23. IN_REVIEW count', async () => {
    expect((await analytics()).audit.inReview).toBe(1);
  });

  it('24. APPROVED count', async () => {
    expect((await analytics()).audit.approved).toBe(1);
  });

  it('25. REJECTED count is not NOT_APPLIED', async () => {
    const result = await analytics();
    expect(result.audit.rejected).toBe(1);
    expect(result.audit.rejected).not.toBe(result.outcomes.notAppliedCount);
  });

  it('26. tariff and supplier cost stay in separate families', async () => {
    const economics = (await analytics()).economics!;
    expect(economics.compensar.acceptedTariffSnapshotValue.value).toBe('300.00');
    expect(economics.olp.acceptedSupplierValue.value).toBe('150.00');
    expect(economics.compensar.acceptedTariffSnapshotValue.value).not.toBe(
      economics.olp.acceptedSupplierValue.value,
    );
  });

  it('27. accepted supplier value is exact', async () => {
    expect((await analytics()).economics?.olp.acceptedSupplierValue).toEqual({
      availability: 'EXACT',
      value: '150.00',
      reason: null,
      basis: 'PURCHASE_ORDER_SNAPSHOT',
    });
  });

  it('28. dispatched supplier value is exact', async () => {
    expect((await analytics()).economics?.olp.dispatchedSupplierValue).toEqual({
      availability: 'EXACT',
      value: '140.00',
      reason: null,
      basis: 'PURCHASE_ORDER_SNAPSHOT',
    });
  });

  it('29. accepted receipt supplier value is exact', async () => {
    expect((await analytics()).economics?.olp.acceptedReceiptSupplierValue).toEqual({
      availability: 'EXACT',
      value: '100.00',
      reason: null,
      basis: 'PURCHASE_ORDER_SNAPSHOT',
    });
  });

  it('30. applied supplier cost is not fabricated', async () => {
    expect((await analytics()).economics?.olp.appliedSupplierCost).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: 'AMBIGUOUS_LOT_PROVENANCE',
      basis: null,
    });
  });

  it('31. current on-hand is not period leftover', async () => {
    const result = await analytics();
    expect(result.inventory.currentOnHandQuantity).not.toBe(
      result.inventory.receivedMinusAppliedFlow.value,
    );
    expect(result.inventory.receivedMinusAppliedFlow.label).toBe('receivedMinusAppliedFlow');
    expect(result.inventory.receivedMinusAppliedFlow.disclaimer).toContain(
      'no inventario atribuible',
    );
  });

  it('32. period filter does not reset current inventory', async () => {
    const scoped = await analytics();
    const unscoped = await json<Analytics>(
      await api(
        'GET',
        `/analytics/operational?dispensingPointId=${pointId}&commercialCode=${product}`,
      ),
    );
    expect(scoped.inventory.currentOnHandQuantity).toBe(unscoped.inventory.currentOnHandQuantity);
  });

  it('33. transfers do not create or destroy controlled quantity', async () => {
    const result = await analytics();
    expect(result.inventory.currentOnHandQuantity + result.inventory.inTransitQuantity).toBe(13);
  });

  it('34. cancelled and draft documents are excluded from issued purchase metrics', async () => {
    const result = await analytics();
    expect(result.procurement.requestedQuantity).toBe(21);
    expect(result.funnel.requestedQuantity).toBe(21);
  });

  it('35. RBAC MTD can read analytics', async () => {
    const response = await api(
      'GET',
      `/analytics/operational?planningPeriodId=${periodId}`,
      undefined,
      mtdToken,
    );
    expect(response.status).toBe(200);
  });

  it('36. Medicarte 403', async () => {
    expect(
      (
        await api(
          'GET',
          `/analytics/operational?planningPeriodId=${periodId}`,
          undefined,
          medicarteToken,
          ORGANIZATION_IDS.MEDICARTE,
        )
      ).status,
    ).toBe(403);
  });

  it('37. OLP 403', async () => {
    expect(
      (
        await api(
          'GET',
          `/analytics/operational?planningPeriodId=${periodId}`,
          undefined,
          olpToken,
          ORGANIZATION_IDS.OLP,
        )
      ).status,
    ).toBe(403);
  });

  it('38. Compensar 403', async () => {
    expect(
      (
        await api(
          'GET',
          `/analytics/operational?planningPeriodId=${periodId}`,
          undefined,
          compensarToken,
          ORGANIZATION_IDS.COMPENSAR,
        )
      ).status,
    ).toBe(403);
  });

  it('39. analytics endpoints do not mutate operational data', async () => {
    const before = (
      await db.query<{ n: string }>(
        `select md5(string_agg(id::text || updated_at::text, ',' order by id)) n from purchase_orders where id=any($1::uuid[])`,
        [orderIds],
      )
    ).rows[0]!.n;
    await analytics();
    await api('GET', `/analytics/novelties?planningPeriodId=${periodId}`);
    await api('GET', `/analytics/inventory?planningPeriodId=${periodId}`);
    await api('GET', `/analytics/economics?planningPeriodId=${periodId}`);
    await api('GET', `/analytics/drilldown?kind=applied&planningPeriodId=${periodId}`);
    const after = (
      await db.query<{ n: string }>(
        `select md5(string_agg(id::text || updated_at::text, ',' order by id)) n from purchase_orders where id=any($1::uuid[])`,
        [orderIds],
      )
    ).rows[0]!.n;
    expect(after).toBe(before);
  });

  it('40. historical purchase entities remain unchanged', async () => {
    const row = (
      await db.query<{ status: string; updated_at: string }>(
        `select status, updated_at::text from purchase_orders where id=$1`,
        [acceptedOrderId],
      )
    ).rows[0]!;
    expect(row.status).toBe('ACCEPTED');
    expect(row.updated_at).toBe(acceptedOrderUpdatedAt);
  });

  it('41. historical period without period-effective tariff stays unavailable', async () => {
    const result = await analytics({
      planningPeriodId: historicalPeriodId,
      commercialCode: historicalProduct,
    });
    const currentAnnexWouldBe = '200.00';
    expect(result.demand.projectedQuantity).toBe(10);
    expect(result.economics?.compensar.projectedTariffReferenceValue).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: 'HISTORICAL_TARIFF_UNAVAILABLE',
      basis: null,
    });
    expect(result.economics?.compensar.projectedTariffReferenceValue.value).not.toBe(
      currentAnnexWouldBe,
    );
  });

  it('42. current active annex is not a historical projected tariff substitute', async () => {
    const result = await analytics();
    const liveAnnexProjection = '480.00';
    expect(result.economics?.compensar.projectedTariffReferenceValue.availability).toBe(
      'UNAVAILABLE',
    );
    expect(result.economics?.compensar.projectedTariffReferenceValue.reason).toBe(
      'HISTORICAL_TARIFF_UNAVAILABLE',
    );
    expect(result.economics?.compensar.projectedTariffReferenceValue.value).not.toBe(
      liveAnnexProjection,
    );
    expect(result.economics?.compensar.projectedTariffReferenceValue.basis).toBeNull();
  });

  it('43. historical purchase-order tariff snapshot remains exact for that order', async () => {
    const result = await analytics({
      planningPeriodId: historicalPeriodId,
      commercialCode: historicalProduct,
    });
    expect(result.economics?.compensar.requestedTariffSnapshotValue).toEqual({
      availability: 'EXACT',
      value: '120.00',
      reason: null,
      basis: 'PURCHASE_ORDER_SNAPSHOT',
    });
    expect(result.economics?.compensar.acceptedTariffSnapshotValue).toEqual({
      availability: 'EXACT',
      value: '120.00',
      reason: null,
      basis: 'PURCHASE_ORDER_SNAPSHOT',
    });
    expect(result.economics?.compensar.projectedTariffReferenceValue.availability).toBe(
      'UNAVAILABLE',
    );
  });

  it('44. applied supplier cost stays unavailable with ambiguous lot provenance', async () => {
    const historical = await analytics({
      planningPeriodId: historicalPeriodId,
      commercialCode: historicalProduct,
    });
    expect(historical.economics?.olp.appliedSupplierCost).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: 'AMBIGUOUS_LOT_PROVENANCE',
      basis: null,
    });
  });

  it('45. draft allocation covers demand without counting as requested', async () => {
    const result = await analytics({ commercialCode: coverageProduct });
    expect(result.demand.projectedQuantity).toBe(100);
    expect(result.procurement.effectivePurchaseCoverage).toBe(100);
    expect(result.procurement.requestedQuantity).toBe(0);
    expect(result.funnel.requestedQuantity).toBe(0);
  });

  it('46. API keeps coverage and requested as distinct metrics', async () => {
    const result = await analytics({ commercialCode: coverageProduct });
    expect(result.procurement.effectivePurchaseCoverage).not.toBe(
      result.procurement.requestedQuantity,
    );
    expect(result.procurement).toEqual(
      expect.objectContaining({
        effectivePurchaseCoverage: 100,
        requestedQuantity: 0,
      }),
    );
    expect(result.funnel).toEqual(expect.objectContaining({ requestedQuantity: 0 }));
    expect(result.funnel).not.toHaveProperty('effectivePurchaseCoverage');
  });
});
