import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  grantMedicarteOperatorPoints,
} from './helpers/auth';

type Json = Record<string, any>;

type Finding = {
  name: string;
  expected: string;
  observed: string;
  pass: boolean;
  severity: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';
  details?: unknown;
};

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@127.0.0.1:15432/authorization_ui_prodshadow';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8).toUpperCase();
const CODE = `POE2E-${suffix}`;
const POINT_CODE = `POE2E-PT-${suffix}`;
const PO_CODE = `PO-E2E-${suffix}`;
const INVIMA = `9${suffix.replace(/\D/g, '').padEnd(11, '7').slice(0, 11)}`;
const PRESENTATION = '1';

const daySeed = (parseInt(suffix.replace(/\D/g, '').slice(0, 4) || '17', 10) % 20) + 1;
const dd = String(daySeed).padStart(2, '0');
const PERIOD_START = `2098-10-${dd}`;
const PERIOD_END = `2098-10-${String(Math.min(daySeed + 6, 28)).padStart(2, '0')}`;
const COMMITTED_DATE = '2098-11-01';
const DECLARED_DISPATCH_DATE = '2098-11-02';
const RECEIVED_AT = '2098-11-03T10:30:00-05:00';
const EXPIRATION_DATE = '2099-12-31';

let adminToken = '';
let olpToken = '';
let medicarteToken = '';
let foundationUserId = '';
let periodId = '';
let pointId = '';
let demandId = '';
let poId = '';
let poLineId = '';
let poVersion = 0;
let deliveryId = '';
let deliveryLineId = '';
let receiptId = '';

const findings: Finding[] = [];

function record(
  name: string,
  pass: boolean,
  expected: unknown,
  observed: unknown,
  severity: Finding['severity'] = 'ERROR',
  details?: unknown,
): void {
  findings.push({
    name,
    pass,
    expected: String(expected),
    observed: String(observed),
    severity,
    ...(details === undefined ? {} : { details }),
  });
}

function bodyCode(body: any): string | null {
  return body?.code ?? body?.error?.code ?? body?.message?.code ?? null;
}

async function request(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    token?: string;
    organizationId?: string;
  } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${opts.token ?? adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': opts.organizationId ?? ORGANIZATION_IDS.MTD,
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });

  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function versionOf(body: any): number {
  const value = Number(body?.version);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Response has no valid version: ${JSON.stringify(body)}`);
  }
  return value;
}

function idOf(body: any): string {
  if (typeof body?.id !== 'string') {
    throw new Error(`Response has no id: ${JSON.stringify(body)}`);
  }
  return body.id;
}

async function assertShadow(): Promise<void> {
  const result = await database.query<{ db: string }>('select current_database() db');
  const db = result.rows[0]?.db;
  if (
    !db ||
    !/^authorization_e2e_\d{14}$/.test(db)
  ) {
    throw new Error(
      `SAFETY_STOP: expected authorization_e2e_<RUN_ID>, got ${String(db)}`,
    );
  }
}

async function seedFixture(): Promise<void> {
  const user = await database.query<{ id: string }>(
    `select id from users where username='foundation-admin'`,
  );
  foundationUserId = user.rows[0]?.id ?? '';
  if (!foundationUserId) throw new Error('foundation-admin not found');

  const period = await database.query<{ id: string }>(
    `insert into planning_periods (
       start_date, end_date, scheduling_cutoff_at,
       purchase_order_deadline_at, expected_delivery_date,
       created_by, updated_by
     )
     values (
       $1, $2,
       ($1::date - interval '2 day')::timestamptz,
       ($1::date - interval '1 day')::timestamptz,
       ($2::date + interval '1 day')::date,
       $3, $3
     )
     returning id`,
    [PERIOD_START, PERIOD_END, foundationUserId],
  );
  periodId = period.rows[0]!.id;

  const point = await database.query<{ id: string }>(
    `insert into dispensing_points (
       organization_id, code, name, active, created_by
     )
     values ($1,$2,$3,true,$4)
     returning id`,
    [
      ORGANIZATION_IDS.MEDICARTE,
      POINT_CODE,
      `PO E2E Medicarte ${suffix}`,
      foundationUserId,
    ],
  );
  pointId = point.rows[0]!.id;

  await database.query(
    `insert into tariff_annex_products (
       codigo_producto,
       tarifa_unidad,
       tarifa_unidad_canonical,
       descripcion_generica,
       descripcion_comercial,
       numero_expediente_invima,
       consecutivo_invima_presentacion,
       tipo_inclusion,
       active,
       organization_id,
       created_by,
       updated_by
     )
     values (
       $1,'125000','125000',
       'Producto PO E2E','Producto PO E2E',
       $2,$3,'PBS',true,$4,$5,$5
     )`,
    [CODE, INVIMA, PRESENTATION, ORGANIZATION_IDS.MTD, foundationUserId],
  );

  await database.query(
    `insert into product_delivery_point_mappings (
       invima_record_normalized,
       invima_presentation_normalized,
       source_cum_code,
       service_model,
       source_site_name,
       dispensing_point_id,
       created_by,
       updated_by
     )
     values ($1,$2,$3,'E2E',$4,$5,$6,$6)`,
    [INVIMA, PRESENTATION, `${INVIMA}-01`, POINT_CODE, pointId, foundationUserId],
  );

  const demand = await database.query<{ id: string }>(
    `insert into projected_demand_lines (
       planning_period_id,
       dispensing_point_id,
       commercial_code,
       projected_quantity,
       regular_quantity,
       late_quantity,
       created_by,
       updated_by
     )
     values ($1,null,$2,20,20,0,$3,$3)
     returning id`,
    [periodId, CODE, foundationUserId],
  );
  demandId = demand.rows[0]!.id;

  await grantMedicarteOperatorPoints(database, [pointId]);
}

async function summarizeDatabase(): Promise<Json> {
  if (!poId) return {};
  const po = await database.query(
    `select
       to_jsonb(po) po,
       (
         select jsonb_agg(to_jsonb(pol))
         from purchase_order_lines pol
         where pol.purchase_order_id=po.id
       ) lines
     from purchase_orders po
     where po.id=$1`,
    [poId],
  );

  const deliveries = await database.query(
    `select
       to_jsonb(d) delivery,
       (
         select jsonb_agg(to_jsonb(dl))
         from delivery_lines dl
         where dl.delivery_id=d.id
       ) lines
     from deliveries d
     where d.purchase_order_id=$1
     order by d.created_at`,
    [poId],
  );

  const receipts = await database.query(
    `select
       to_jsonb(r) receipt,
       (
         select jsonb_agg(to_jsonb(rl))
         from receipt_lines rl
         where rl.receipt_id=r.id
       ) lines
     from receipts r
     join deliveries d on d.id=r.delivery_id
     where d.purchase_order_id=$1
     order by r.created_at`,
    [poId],
  );

  const inventory = await database.query<{
    quantity_delta: number;
  }>(
    `select
       coalesce(sum(im.quantity_delta),0)::int quantity_delta
     from inventory_movements im
     join receipt_lines rl
       on rl.id=im.source_id
     join receipts r
       on r.id=rl.receipt_id
     join deliveries d
       on d.id=r.delivery_id
     where im.movement_type='RECEIPT'
       and im.source_type='RECEIPT_LINE'
       and d.purchase_order_id=$1`,
    [poId],
  );

  return {
    purchaseOrder: po.rows[0] ?? null,
    deliveries: deliveries.rows,
    receipts: receipts.rows,
    receiptInventoryDelta: inventory.rows[0]?.quantity_delta ?? 0,
  };
}

beforeAll(async () => {
  await database.connect();
  await assertShadow();

  const health = await fetch(`${apiUrl}/api/v1/health`).catch(() => null);
  if (!health) {
    throw new Error(`API unavailable at ${apiUrl}`);
  }

  adminToken = await adminLogin();
  ({ olpToken, medicarteToken } = await ensureOperatorTokens());
  await seedFixture();
}, 30_000);

afterAll(async () => {
  console.log('\n================ PO OPERATIONAL E2E MATRIX ================');
  console.table(
    findings.map(({ name, pass, severity, expected, observed }) => ({
      result: pass ? 'PASS' : 'FAIL',
      severity,
      scenario: name,
      expected,
      observed,
    })),
  );

  const failed = findings.filter((f) => !f.pass);
  const critical = failed.filter((f) => f.severity === 'CRITICAL');

  console.log(
    JSON.stringify(
      {
        fixture: {
          code: CODE,
          purchaseOrderCode: PO_CODE,
          purchaseOrderId: poId || null,
          deliveryId: deliveryId || null,
          receiptId: receiptId || null,
        },
        totals: {
          scenarios: findings.length,
          passed: findings.length - failed.length,
          failed: failed.length,
          critical: critical.length,
        },
        failures: failed,
        database: await summarizeDatabase().catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        })),
      },
      null,
      2,
    ),
  );

  await database.end();
});

describe('PO operational cycle — ephemeral E2E gate', () => {
  it('runs MTD → OLP → Medicarte and records expected/negative outcomes', async () => {
    // 1) MTD creates PO.
    const created = await request('POST', '/purchase-orders', {
      body: {
        planningPeriodId: periodId,
        orderType: 'STANDARD',
        purchaseOrderCode: PO_CODE,
        lines: [
          {
            projectedDemandLineId: demandId,
            expectedDemandRevision: 1,
            requestedQuantity: 20,
            demandBucket: 'REGULAR',
          },
        ],
      },
    });

    record('MTD creates purchase order', created.status === 201, 201, created.status, 'CRITICAL', created.body);
    if (created.status !== 201) throw new Error(`Cannot continue: PO create ${created.status} ${JSON.stringify(created.body)}`);

    poId = idOf(created.body);
    poVersion = versionOf(created.body);
    poLineId = created.body.lines?.[0]?.id;

    const apiTarget = await database.query<{ found: boolean }>(
      `select exists(select 1 from purchase_orders where id=$1) found`,
      [poId],
    );
    const apiUsesEphemeral = apiTarget.rows[0]?.found === true;
    record(
      'API is connected to the same ephemeral E2E database',
      apiUsesEphemeral,
      true,
      apiTarget.rows[0]?.found ?? false,
      'CRITICAL',
      apiUsesEphemeral ? undefined : 'API_DATABASE_MISMATCH',
    );
    if (!apiUsesEphemeral) {
      throw new Error(
        'API_DATABASE_MISMATCH: API created the PO outside the ephemeral E2E database',
      );
    }

    record('Requested quantity starts at 20', created.body.lines?.[0]?.requestedQuantity === 20, 20, created.body.lines?.[0]?.requestedQuantity, 'CRITICAL');

    if (!poLineId) {
      throw new Error(
        'PO_LINE_ID_MISSING',
      );
    }


    // 2) MTD issues PO.
    const issued = await request('POST', `/purchase-orders/${poId}/issue`, {
      body: { expectedVersion: poVersion },
    });
    record('MTD issues PO', issued.status === 200, 200, issued.status, 'CRITICAL', issued.body);
    if (issued.status !== 200) throw new Error(`Cannot continue: issue ${issued.status} ${JSON.stringify(issued.body)}`);
    poVersion = versionOf(issued.body);

    // 3) Enterprise actor boundary: MTD cannot accept as OLP.
    const mtdAccept = await request('POST', `/supplier/purchase-orders/${poId}/accept`, {
      body: {
        expectedVersion: poVersion,
        committedDate: COMMITTED_DATE,
        observation: 'MTD must not be allowed to accept OLP operation',
      },
      token: adminToken,
      organizationId: ORGANIZATION_IDS.MTD,
    });
    record('MTD cannot accept OLP purchase order', mtdAccept.status === 403, 403, mtdAccept.status, 'CRITICAL', mtdAccept.body);

    // 4) OLP accepts.
    const accepted = await request('POST', `/supplier/purchase-orders/${poId}/accept`, {
      body: {
        expectedVersion:
          poVersion,

        committedDate:
          COMMITTED_DATE,

        observation:
          'PO E2E OLP acceptance',

        lines: [
          {
            lineId:
              poLineId,

            supplierUnitCost:
              700,
          },
        ],
      },
      token: olpToken,
      organizationId: ORGANIZATION_IDS.OLP,
    });
    record('OLP accepts PO', accepted.status === 200, 200, accepted.status, 'CRITICAL', accepted.body);
    if (accepted.status !== 200) throw new Error(`Cannot continue: OLP accept ${accepted.status} ${JSON.stringify(accepted.body)}`);
    const acceptedVersion = versionOf(accepted.body);

    const acceptanceSnapshot = await database.query<{
      accepted_at: string | null;
      accepted_by: string | null;
      committed_date: string | null;
      requested_quantity: number;
    }>(
      `select
         to_jsonb(po)->>'olp_accepted_at' accepted_at,
         to_jsonb(po)->>'olp_accepted_by' accepted_by,
         to_jsonb(po)->>'olp_committed_date' committed_date,
         pol.requested_quantity
       from purchase_orders po
       join purchase_order_lines pol on pol.purchase_order_id=po.id
       where po.id=$1`,
      [poId],
    );

    const as = acceptanceSnapshot.rows[0]!;
    record('Acceptance has server timestamp', Boolean(as.accepted_at), 'non-null', as.accepted_at, 'ERROR');
    record('Acceptance has server actor', Boolean(as.accepted_by), 'non-null', as.accepted_by, 'ERROR');
    record('Committed date persisted separately', as.committed_date === COMMITTED_DATE, COMMITTED_DATE, as.committed_date, 'ERROR');
    record('Acceptance does not mutate requested quantity', as.requested_quantity === 20, 20, as.requested_quantity, 'CRITICAL');

    // 5) Double acceptance.
    const doubleAccept = await request('POST', `/supplier/purchase-orders/${poId}/accept`, {
      body: {
        expectedVersion:
          acceptedVersion,

        committedDate:
          COMMITTED_DATE,

        lines: [
          {
            lineId:
              poLineId,

            supplierUnitCost:
              700,
          },
        ],
      },
      token: olpToken,
      organizationId: ORGANIZATION_IDS.OLP,
    });
    record(
      'Double OLP acceptance is rejected',
      doubleAccept.status === 409,
      409,
      doubleAccept.status,
      'ERROR',
      { code: bodyCode(doubleAccept.body), body: doubleAccept.body },
    );

    // 6) Medicarte cannot create supplier delivery.
    const medicarteSupplierAttempt = await request('POST', '/supplier/deliveries', {
      body: {
        purchaseOrderId: poId,
        supplierReference: `DENIED-${suffix}`,
        lines: [{
          purchaseOrderLineId: poLineId,
          quantity: 1,
          lotNumber: `LOT-${suffix}`,
          expirationDate: EXPIRATION_DATE,
        }],
      },
      token: medicarteToken,
      organizationId: ORGANIZATION_IDS.MEDICARTE,
    });
    record('Medicarte cannot perform OLP dispatch creation', medicarteSupplierAttempt.status === 403, 403, medicarteSupplierAttempt.status, 'CRITICAL', medicarteSupplierAttempt.body);

    // 7) Over-dispatch attempt: 21 > requested/accepted 20.
    const overDispatch = await request('POST', '/supplier/deliveries', {
      body: {
        purchaseOrderId: poId,
        supplierReference: `OVER-${suffix}`,
        lines: [{
          purchaseOrderLineId: poLineId,
          quantity: 21,
          lotNumber: `LOT-OVER-${suffix}`,
          expirationDate: EXPIRATION_DATE,
        }],
      },
      token: olpToken,
      organizationId: ORGANIZATION_IDS.OLP,
    });

    record(
      'OLP cannot create over-dispatch',
      overDispatch.status === 409 || overDispatch.status === 400,
      '400/409',
      overDispatch.status,
      'CRITICAL',
      { code: bodyCode(overDispatch.body), body: overDispatch.body },
    );

    // If legacy code created it as draft, cancel it so it cannot affect the main flow.
    if (overDispatch.status === 201 && overDispatch.body?.id && overDispatch.body?.version) {
      await request('POST', `/supplier/deliveries/${overDispatch.body.id}/cancel`, {
        body: { expectedVersion: overDispatch.body.version },
        token: olpToken,
        organizationId: ORGANIZATION_IDS.OLP,
      });
    }

    // 8) Valid partial dispatch of 18/20.
    const delivery = await request('POST', '/supplier/deliveries', {
      body: {
        purchaseOrderId: poId,
        supplierReference: `DSP-${suffix}`,
        declaredDispatchDate: DECLARED_DISPATCH_DATE,
        lines: [{
          purchaseOrderLineId: poLineId,
          quantity: 18,
          lotNumber: `LOT-${suffix}`,
          expirationDate: EXPIRATION_DATE,
        }],
      },
      token: olpToken,
      organizationId: ORGANIZATION_IDS.OLP,
    });

    record('OLP creates dispatch 18/20', delivery.status === 201, 201, delivery.status, 'CRITICAL', delivery.body);
    if (delivery.status !== 201) throw new Error(`Cannot continue: delivery create ${delivery.status} ${JSON.stringify(delivery.body)}`);
    deliveryId = idOf(delivery.body);
    deliveryLineId = delivery.body.lines?.[0]?.id;
    let deliveryVersion = versionOf(delivery.body);

    const dispatched = await request('POST', `/supplier/deliveries/${deliveryId}/dispatch`, {
      body: {
        expectedVersion: deliveryVersion,
        declaredDispatchDate: DECLARED_DISPATCH_DATE,
      },
      token: olpToken,
      organizationId: ORGANIZATION_IDS.OLP,
    });

    record('OLP dispatches 18 units', dispatched.status === 200, 200, dispatched.status, 'CRITICAL', dispatched.body);
    if (dispatched.status !== 200) throw new Error(`Cannot continue: dispatch ${dispatched.status} ${JSON.stringify(dispatched.body)}`);

    const dispatchSnapshot = await database.query<{
      dispatched_at: string | null;
      dispatched_by: string | null;
      declared_dispatch_date: string | null;
    }>(
      `select
         to_jsonb(d)->>'dispatched_at' dispatched_at,
         to_jsonb(d)->>'dispatched_by' dispatched_by,
         to_jsonb(d)->>'declared_dispatch_date' declared_dispatch_date
       from deliveries d
       where d.id=$1`,
      [deliveryId],
    );

    const ds = dispatchSnapshot.rows[0]!;
    record('Dispatch has server timestamp', Boolean(ds.dispatched_at), 'non-null', ds.dispatched_at, 'ERROR');
    record('Dispatch records server actor', Boolean(ds.dispatched_by), 'non-null', ds.dispatched_by, 'WARNING');
    record(
      'Declared dispatch date persisted separately',
      ds.declared_dispatch_date === DECLARED_DISPATCH_DATE,
      DECLARED_DISPATCH_DATE,
      ds.declared_dispatch_date,
      'ERROR',
    );

    // 9) OLP cannot receive as Medicarte.
    const olpReceiptAttempt = await request('POST', '/medicarte/receipts', {
      body: { deliveryId },
      token: olpToken,
      organizationId: ORGANIZATION_IDS.OLP,
    });
    record('OLP cannot create Medicarte receipt', olpReceiptAttempt.status === 403, 403, olpReceiptAttempt.status, 'CRITICAL', olpReceiptAttempt.body);

    // 10) Medicarte creates receipt draft.
    const receipt = await request('POST', '/medicarte/receipts', {
      body: { deliveryId },
      token: medicarteToken,
      organizationId: ORGANIZATION_IDS.MEDICARTE,
    });

    record('Medicarte creates receipt', receipt.status === 201, 201, receipt.status, 'CRITICAL', receipt.body);
    if (receipt.status !== 201) throw new Error(`Cannot continue: receipt create ${receipt.status} ${JSON.stringify(receipt.body)}`);
    receiptId = idOf(receipt.body);
    let receiptVersion = versionOf(receipt.body);
    const receiptDeliveryLineId = receipt.body.lines?.[0]?.deliveryLineId ?? deliveryLineId;

    // 11) Over-receipt 19 > dispatched 18.
    const overReceipt = await request('PATCH', `/medicarte/receipts/${receiptId}`, {
      body: {
        expectedVersion: receiptVersion,
        receivedAt: RECEIVED_AT,
        lines: [{
          deliveryLineId: receiptDeliveryLineId,
          receivedQuantity: 19,
          acceptedQuantity: 19,
          rejectedQuantity: 0,
          receivedLotNumber: `LOT-${suffix}`,
          receivedExpirationDate: EXPIRATION_DATE,
          observation: 'Must fail: over receipt',
        }],
      },
      token: medicarteToken,
      organizationId: ORGANIZATION_IDS.MEDICARTE,
    });

    record(
      'Medicarte cannot over-receive 19/18',
      overReceipt.status === 409 || overReceipt.status === 400,
      '400/409',
      overReceipt.status,
      'CRITICAL',
      { code: bodyCode(overReceipt.body), body: overReceipt.body },
    );

    // 12) Valid physical receipt 17 of 18.
    const updatedReceipt = await request('PATCH', `/medicarte/receipts/${receiptId}`, {
      body: {
        expectedVersion: receiptVersion,
        receivedAt: RECEIVED_AT,
        lines: [{
          deliveryLineId: receiptDeliveryLineId,
          receivedQuantity: 17,
          acceptedQuantity: 17,
          rejectedQuantity: 0,
          receivedLotNumber: `LOT-${suffix}`,
          receivedExpirationDate: EXPIRATION_DATE,
          observation: 'Physical receipt 17 of dispatched 18',
        }],
      },
      token: medicarteToken,
      organizationId: ORGANIZATION_IDS.MEDICARTE,
    });

    record('Medicarte records partial physical receipt 17/18', updatedReceipt.status === 200, 200, updatedReceipt.status, 'CRITICAL', updatedReceipt.body);
    if (updatedReceipt.status !== 200) throw new Error(`Cannot continue: receipt update ${updatedReceipt.status} ${JSON.stringify(updatedReceipt.body)}`);
    const originalReceiptVersion = receiptVersion;
    receiptVersion = versionOf(updatedReceipt.body);

    // 13) stale version.
    const staleConfirm = await request('POST', `/medicarte/receipts/${receiptId}/confirm`, {
      body: { expectedVersion: originalReceiptVersion },
      token: medicarteToken,
      organizationId: ORGANIZATION_IDS.MEDICARTE,
    });
    record('Stale receipt version is rejected', staleConfirm.status === 409, 409, staleConfirm.status, 'ERROR', staleConfirm.body);

    // 14) Confirm receipt.
    const confirmed = await request('POST', `/medicarte/receipts/${receiptId}/confirm`, {
      body: { expectedVersion: receiptVersion },
      token: medicarteToken,
      organizationId: ORGANIZATION_IDS.MEDICARTE,
    });

    record('Medicarte confirms physical receipt', confirmed.status === 201 || confirmed.status === 200, '200/201', confirmed.status, 'CRITICAL', confirmed.body);
    if (!(confirmed.status === 200 || confirmed.status === 201)) {
      throw new Error(`Cannot continue: receipt confirm ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
    }

    // 15) Inventory must increase immediately by 17 accepted units.
    const inv = await database.query<{ qty: number }>(
      `select
         coalesce(sum(im.quantity_delta),0)::int qty

       from inventory_movements im

       join receipt_lines rl
         on rl.id = im.source_id

       where
         im.movement_type='RECEIPT'
         and im.source_type='RECEIPT_LINE'
         and rl.receipt_id=$1`,
      [receiptId],
    );
    record('Confirmed receipt increments inventory immediately', inv.rows[0]!.qty === 17, 17, inv.rows[0]!.qty, 'CRITICAL');

    // 16) Requested quantity is still immutable.
    const qty = await database.query<{ requested: number; accepted: number | null }>(
      `select requested_quantity requested, accepted_quantity accepted
       from purchase_order_lines
       where id=$1`,
      [poLineId],
    );
    record('Requested quantity remains immutable after dispatch/receipt', qty.rows[0]!.requested === 20, 20, qty.rows[0]!.requested, 'CRITICAL');

    // 17) 20 requested / 18 dispatched / 17 received => pending total must be 3.
    const totals = await database.query<{
      requested: number;
      dispatched: number;
      received: number;
    }>(
      `select
         pol.requested_quantity::int requested,
         coalesce((
           select sum(dl.quantity)
           from delivery_lines dl
           join deliveries d on d.id=dl.delivery_id
           where d.purchase_order_id=pol.purchase_order_id
             and dl.purchase_order_line_id=pol.id
             and d.status in ('DISPATCHED','RECEIVED')
         ),0)::int dispatched,
         coalesce((
           select sum(rl.received_quantity)
           from receipt_lines rl
           join receipts r on r.id=rl.receipt_id
           join delivery_lines dl on dl.id=rl.delivery_line_id
           join deliveries d on d.id=dl.delivery_id
           where d.purchase_order_id=pol.purchase_order_id
             and dl.purchase_order_line_id=pol.id
             and r.status='CONFIRMED'
         ),0)::int received
       from purchase_order_lines pol
       where pol.id=$1`,
      [poLineId],
    );

    const t = totals.rows[0]!;
    const supplierShortfall = t.requested - t.dispatched;
    const receiptDifference = t.dispatched - t.received;
    const totalPending = t.requested - t.received;

    record('Supplier shortfall = 2', supplierShortfall === 2, 2, supplierShortfall, 'CRITICAL');
    record('Dispatch/receipt difference = 1', receiptDifference === 1, 1, receiptDifference, 'CRITICAL');
    record('Total PO pending = 3', totalPending === 3, 3, totalPending, 'CRITICAL');

    // 18) Macro lifecycle must still be "received with pending", never fully received.
    const poAfterReceipt = await request('GET', `/purchase-orders/${poId}`, {
      token: adminToken,
      organizationId: ORGANIZATION_IDS.MTD,
    });
    const observedStatus = poAfterReceipt.body?.macroState ?? poAfterReceipt.body?.status ?? null;
    const pendingStatusOk = ['RECEIVED_WITH_PENDING', 'PARTIALLY_RECEIVED'].includes(observedStatus);
    record(
      '20 requested / 18 dispatched / 17 received is not fully received',
      pendingStatusOk,
      'RECEIVED_WITH_PENDING/PARTIALLY_RECEIVED',
      observedStatus,
      'CRITICAL',
      poAfterReceipt.body,
    );

    // 19) Desired model permits another physical receipt against the outstanding dispatch.
    const secondReceipt = await request('POST', '/medicarte/receipts', {
      body: { deliveryId },
      token: medicarteToken,
      organizationId: ORGANIZATION_IDS.MEDICARTE,
    });

    record(
      'Same dispatch can have another receipt while 1 unit remains physically pending',
      secondReceipt.status === 201,
      201,
      secondReceipt.status,
      'CRITICAL',
      {
        code: bodyCode(secondReceipt.body),
        body: secondReceipt.body,
        interpretation:
          secondReceipt.status === 409
            ? 'Legacy one-confirmed-receipt-per-delivery model is still active'
            : undefined,
      },
    );

    // 20) Final safety snapshot: source DB must not be the target.
    const currentDb = await database.query<{ db: string }>('select current_database() db');
    const currentDbName =
      currentDb.rows[0]!.db;

    const ephemeralDatabase =
      /^authorization_e2e_\d{14}$/.test(
        currentDbName,
      );

    record(
      'Test executed only on ephemeral E2E database',
      ephemeralDatabase,
      'authorization_e2e_<YYYYMMDDHHMMSS>',
      currentDbName,
      'CRITICAL',
    );

    // The exploratory gate intentionally does NOT fail merely because business gaps were found:
    // it only fails when the harness itself could not complete its critical operational path.
    const harnessCritical = findings.filter(
      (f) =>
        !f.pass &&
        f.severity === 'CRITICAL' &&
        [
          'MTD creates purchase order',
          'MTD issues PO',
          'OLP accepts PO',
          'OLP creates dispatch 18/20',
          'OLP dispatches 18 units',
          'Medicarte creates receipt',
          'Medicarte records partial physical receipt 17/18',
          'Medicarte confirms physical receipt',
          'Test executed only on ephemeral E2E database',
        ].includes(f.name),
    );

    expect(harnessCritical, JSON.stringify(harnessCritical, null, 2)).toHaveLength(0);
  }, 60_000);
});
