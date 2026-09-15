import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  ensureUser,
  deletePointScopesForPoints,
} from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8);
const CODE = `ESP15-CODE-${suffix.toUpperCase()}`;
const DOC = `DOC-015-${suffix}`;
const POINT_A_CODE = `ESP15-A-${suffix}`;
const POINT_B_CODE = `ESP15-B-${suffix}`;
const POINT_INACTIVE_CODE = `ESP15-X-${suffix}`;
const PERIOD = { from: '2051-03-01', to: '2051-03-31' };
const DATE_A = '2051-03-10';
const DATE_B = '2051-03-11';
const HEADER = [
  'AUTORIZACION',
  'DOCUMENTO',
  'COD_COMERCIAL',
  'CANTIDAD',
  'PUNTO',
  'FECHA_PROGRAMADA',
];
const META = [
  ['KEY', 'VALUE'],
  ['templateVersion', 'ESP014_SCHEDULING_V1'],
  ['importType', 'SCHEDULING'],
];
const password = `esp015-${suffix}-password`;

let adminToken = '';
let foundationUserId = '';
let emptyToken = '';
let emptyUserId = '';
let scopeAToken = '';
let scopeAUserId = '';
let scopeABToken = '';
let scopeABUserId = '';
let medicarteToken = '';
let olpToken = '';
let compensarToken = '';
let auditorToken = '';
let pointA = '';
let pointB = '';
let inactivePoint = '';
let periodId = '';
let itemA = '';
let itemB = '';
let itemC = '';
let itemD = '';
let itemE = '';
let itemF = '';
let authSnapshot: Record<string, unknown> = {};
const scheduleIds: string[] = [];
const lotIds: string[] = [];
const applicationIds: string[] = [];
const transferIds: string[] = [];
const receiptIds: string[] = [];
const deliveryIds: string[] = [];
const orderIds: string[] = [];

type Job = {
  id: string;
  status: string;
  validRows: number;
  invalidRows: number;
  succeededRows: number;
  failedRows: number;
};
type Row = {
  rowNumber: number;
  validationStatus: string;
  executionStatus: string;
  errorCode: string | null;
};
type Me = {
  organizations: Array<{
    code: string;
    pointAccess: { kind: string; accessiblePointIds: string[] };
  }>;
};

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = scopeAToken,
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

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function codeOf(response: Response): Promise<string | null> {
  return (await json<{ code?: string }>(response)).code ?? null;
}

async function userIdOf(username: string): Promise<string> {
  const result = await database.query<{ id: string }>(`select id from users where username=$1`, [
    username,
  ]);
  return result.rows[0]!.id;
}

async function putPoints(userId: string, pointIds: string[], token = adminToken) {
  return api(
    'PUT',
    `/access-scopes/users/${userId}/points`,
    { pointIds },
    token,
    ORGANIZATION_IDS.MTD,
  );
}

async function insertAuthorization(authorizationNumber: string): Promise<string> {
  const batch = await database.query<{ id: string }>(
    `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at)
     values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
    [ORGANIZATION_IDS.MTD, foundationUserId, `esp015-${authorizationNumber}.json`, 'd'.repeat(64)],
  );
  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       created_from_batch_id)
     values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP015',$5)
     returning id`,
    [
      authorizationNumber,
      CODE,
      `${authorizationNumber}:${CODE}`,
      JSON.stringify({
        IDENTIFICACION_PACIENTE: DOC,
        NOMBRE_PACIENTE: 'Paciente ESP-015',
        CANTIDAD: '5',
        FECHA_FINAL_VIGENCIA: '2099-12-31',
      }),
      batch.rows[0]!.id,
    ],
  );
  const id = item.rows[0]!.id;
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1,$2) on conflict do nothing`,
    [id, ORGANIZATION_IDS.MEDICARTE],
  );
  return id;
}

async function createSchedule(
  authorizationItemId: string,
  pointId: string,
  date: string,
  token: string,
  organizationId = ORGANIZATION_IDS.MEDICARTE,
) {
  const response = await api(
    'POST',
    '/patient-schedules',
    {
      authorizationItemId,
      commercialCode: CODE,
      dispensingPointId: pointId,
      scheduledDate: date,
      quantity: 1,
    },
    token,
    organizationId,
  );
  if (response.status === 201) {
    const created = await json<{ id: string; revision: number }>(response);
    scheduleIds.push(created.id);
    return created;
  }
  return response;
}

async function insertLot(pointId: string, quantity = 4): Promise<string> {
  const lot = (
    await database.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date)
       values ($1,$2,$3,'2099-12-31') returning id`,
      [CODE, pointId, `ESP15-LOT-${randomUUID()}`],
    )
  ).rows[0]!.id;
  lotIds.push(lot);
  await database.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
     values ($1,'ADJUSTMENT',$2,'ADJUSTMENT',$3,now(),$4)`,
    [lot, quantity, randomUUID(), foundationUserId],
  );
  return lot;
}

async function fixtureDelivery(pointId: string): Promise<{
  deliveryId: string;
  deliveryLineId: string;
  lot: string;
}> {
  const orderId = randomUUID();
  const lineId = randomUUID();
  const deliveryId = randomUUID();
  const deliveryLineId = randomUUID();
  const lot = `ESP15-RCPT-${randomUUID().slice(0, 8)}`;
  orderIds.push(orderId);
  deliveryIds.push(deliveryId);
  await database.query(
    `insert into purchase_orders (id,purchase_order_code,planning_period_id,order_type,status,created_by,updated_by)
     values ($1,$2,$3,'STANDARD','FULLY_DISPATCHED',$4,$4)`,
    [orderId, `ESP15-${orderId.slice(0, 8)}`, periodId, foundationUserId],
  );
  await database.query(
    `insert into purchase_order_lines (id,purchase_order_id,commercial_code,product_description,presentation,dispensing_point_id,requested_quantity,accepted_quantity,requested_delivery_date,compensar_unit_rate_snapshot,supplier_unit_cost,projected_demand_line_id,projected_demand_revision,demand_bucket)
     values ($1,$2,$3,'ESP15 product','presentation',$4,5,5,'2051-03-20','10.00','10.00',$5,1,'REGULAR')`,
    [lineId, orderId, CODE, pointId, randomUUID()],
  );
  await database.query(
    `insert into deliveries (id,purchase_order_id,status,dispatched_at,created_by,updated_by)
     values ($1,$2,'DISPATCHED',now(),$3,$3)`,
    [deliveryId, orderId, foundationUserId],
  );
  await database.query(
    `insert into delivery_lines (id,delivery_id,purchase_order_line_id,commercial_code,dispensing_point_id,quantity,lot_number,expiration_date)
     values ($1,$2,$3,$4,$5,5,$6,'2099-12-31')`,
    [deliveryLineId, deliveryId, lineId, CODE, pointId, lot],
  );
  return { deliveryId, deliveryLineId, lot };
}

function workbook(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Programacion');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(META), 'METADATA');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function row(authorization: string, date: string, pointCode: string): unknown[] {
  return [authorization, DOC, CODE, 1, pointCode, date];
}

async function upload(buffer: Buffer, filename: string, token: string): Promise<Response> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
  return fetch(`${apiUrl}/api/v1/bulk-imports/scheduling/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': ORGANIZATION_IDS.MEDICARTE,
    },
    body: form,
  });
}

beforeAll(async () => {
  await database.connect();
  adminToken = await adminLogin();
  foundationUserId = await userIdOf('foundation-admin');
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  emptyToken = await ensureUser({
    adminToken,
    username: `esp015-empty-${suffix}`,
    displayName: 'ESP015 Empty',
    password,
    organizationId: ORGANIZATION_IDS.MEDICARTE,
    roleCode: 'MEDICARTE_OPERATOR',
  });
  scopeAToken = await ensureUser({
    adminToken,
    username: `esp015-a-${suffix}`,
    displayName: 'ESP015 Scope A',
    password,
    organizationId: ORGANIZATION_IDS.MEDICARTE,
    roleCode: 'MEDICARTE_OPERATOR',
  });
  scopeABToken = await ensureUser({
    adminToken,
    username: `esp015-ab-${suffix}`,
    displayName: 'ESP015 Scope AB',
    password,
    organizationId: ORGANIZATION_IDS.MEDICARTE,
    roleCode: 'MEDICARTE_OPERATOR',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp015-comp-${suffix}`,
    displayName: 'ESP015 Compensar',
    password,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  auditorToken = await ensureUser({
    adminToken,
    username: `esp015-audit-${suffix}`,
    displayName: 'ESP015 Auditoria',
    password,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_AUDITORIA',
  });
  emptyUserId = await userIdOf(`esp015-empty-${suffix}`);
  scopeAUserId = await userIdOf(`esp015-a-${suffix}`);
  scopeABUserId = await userIdOf(`esp015-ab-${suffix}`);
  pointA = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, created_by)
       values ($1,$2,'ESP-015 Punto A',$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, POINT_A_CODE, foundationUserId],
    )
  ).rows[0]!.id;
  pointB = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, created_by)
       values ($1,$2,'ESP-015 Punto B',$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, POINT_B_CODE, foundationUserId],
    )
  ).rows[0]!.id;
  inactivePoint = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, active, created_by)
       values ($1,$2,'ESP-015 Inactivo',false,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, POINT_INACTIVE_CODE, foundationUserId],
    )
  ).rows[0]!.id;
  periodId = (
    await database.query<{ id: string }>(
      `insert into planning_periods
        (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by)
       values ($1,$2,'2051-03-28T23:59:00-05:00','2051-03-29T23:59:00-05:00','2051-03-30',$3,$3)
       returning id`,
      [PERIOD.from, PERIOD.to, foundationUserId],
    )
  ).rows[0]!.id;
  itemA = await insertAuthorization(`ESP015-A-${suffix}`);
  itemB = await insertAuthorization(`ESP015-B-${suffix}`);
  itemC = await insertAuthorization(`ESP015-C-${suffix}`);
  itemD = await insertAuthorization(`ESP015-D-${suffix}`);
  itemE = await insertAuthorization(`ESP015-E-${suffix}`);
  itemF = await insertAuthorization(`ESP015-F-${suffix}`);
  const snapshot = await database.query<Record<string, unknown>>(
    `select enablement_status, coverage_type, direction_status from authorization_items where id = $1`,
    [itemA],
  );
  authSnapshot = snapshot.rows[0]!;
  expect((await putPoints(scopeAUserId, [pointA])).status).toBe(200);
  expect((await putPoints(scopeABUserId, [pointA, pointB])).status).toBe(200);
});

afterAll(async () => {
  await database.query(
    `delete from bulk_import_row_attempts where row_id in (
       select r.id from bulk_import_rows r
       join bulk_import_jobs j on j.id = r.job_id
       where j.original_filename like 'esp015-%')`,
  );
  await database.query(
    `delete from bulk_import_rows where job_id in (
       select id from bulk_import_jobs where original_filename like 'esp015-%')`,
  );
  await database.query(`delete from bulk_import_jobs where original_filename like 'esp015-%'`);
  await database.query(
    `alter table patient_applications disable trigger patient_applications_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_application_lines disable trigger patient_application_lines_confirmed_immutable`,
  );
  await database.query(
    `delete from patient_application_lines where patient_application_id = any($1::uuid[])`,
    [applicationIds],
  );
  await database.query(`delete from patient_applications where id = any($1::uuid[])`, [
    applicationIds,
  ]);
  await database.query(
    `alter table patient_application_lines enable trigger patient_application_lines_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_applications enable trigger patient_applications_confirmed_immutable`,
  );
  await database.query(
    `delete from patient_schedule_outcome_lines where outcome_id in
      (select id from patient_schedule_outcomes where patient_schedule_id = any($1::uuid[]))`,
    [scheduleIds],
  );
  await database.query(
    `delete from patient_schedule_outcomes where patient_schedule_id = any($1::uuid[])`,
    [scheduleIds],
  );
  await database.query(
    `delete from stock_transfer_lines where stock_transfer_id = any($1::uuid[])`,
    [transferIds],
  );
  await database.query(`delete from stock_transfers where id = any($1::uuid[])`, [transferIds]);
  await database.query(
    `delete from inventory_movements where inventory_lot_id = any($1::uuid[])
       or source_id in (select id from receipt_lines where receipt_id = any($2::uuid[]))`,
    [lotIds, receiptIds],
  );
  await database.query(`delete from receipt_lines where receipt_id = any($1::uuid[])`, [
    receiptIds,
  ]);
  await database.query(`delete from receipts where id = any($1::uuid[])`, [receiptIds]);
  await database.query(`delete from inventory_lots where id = any($1::uuid[])`, [lotIds]);
  await database.query(`delete from delivery_lines where delivery_id = any($1::uuid[])`, [
    deliveryIds,
  ]);
  await database.query(`delete from deliveries where id = any($1::uuid[])`, [deliveryIds]);
  await database.query(
    `delete from purchase_order_lines where purchase_order_id = any($1::uuid[])`,
    [orderIds],
  );
  await database.query(`delete from purchase_orders where id = any($1::uuid[])`, [orderIds]);
  await database.query(
    `delete from inventory_movements where inventory_lot_id in (
       select id from inventory_lots where commercial_code = $1)`,
    [CODE],
  );
  await database.query(`delete from inventory_lots where commercial_code = $1`, [CODE]);
  await database.query(
    `delete from demand_sources where patient_schedule_id in (
       select id from patient_schedules where planning_period_id = $1 or id = any($2::uuid[]))`,
    [periodId, scheduleIds],
  );
  await database.query(
    `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
  );
  await database.query(
    `delete from patient_schedule_history where patient_schedule_id = any($1::uuid[])`,
    [scheduleIds],
  );
  await database.query(`delete from patient_schedules where id = any($1::uuid[])`, [scheduleIds]);
  await database.query(
    `delete from patient_schedule_history where patient_schedule_id in
      (select id from patient_schedules where planning_period_id = $1)`,
    [periodId],
  );
  await database.query(`delete from patient_schedules where planning_period_id = $1`, [periodId]);
  await database.query(
    `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
  );
  await database.query(
    `delete from authorization_item_organizations where authorization_item_id in
      (select id from authorization_items where numero_autorizacion like $1)`,
    [`ESP015-%${suffix}`],
  );
  await database.query(`delete from authorization_items where numero_autorizacion like $1`, [
    `ESP015-%${suffix}`,
  ]);
  await database.query(`delete from import_batches where original_filename like 'esp015-%'`);
  await deletePointScopesForPoints(database, [pointA, pointB, inactivePoint]);
  await database.query(`delete from user_point_scopes where user_id in ($1,$2,$3)`, [
    emptyUserId,
    scopeAUserId,
    scopeABUserId,
  ]);
  await database.query(`delete from dispensing_points where id in ($1,$2,$3)`, [
    pointA,
    pointB,
    inactivePoint,
  ]);
  await database.query(`delete from planning_periods where id = $1`, [periodId]);
  await database.end();
});

describe('Gate ESP-015 — alcance operacional por punto', () => {
  it('1. Medicarte sin grants no ve puntos y /me queda fail-closed', async () => {
    const me = await json<Me>(await api('GET', '/me', undefined, emptyToken));
    const org = me.organizations.find((item) => item.code === 'MEDICARTE');
    expect(org?.pointAccess).toEqual({ kind: 'explicit', accessiblePointIds: [] });
    const points = await json<{ items: Array<{ id: string }> }>(
      await api('GET', '/patient-schedules/dispensing-points', undefined, emptyToken),
    );
    expect(points.items).toEqual([]);
    const schedules = await json<{ items: unknown[] }>(
      await api('GET', '/patient-schedules', undefined, emptyToken),
    );
    expect(schedules.items).toEqual([]);
    const denied = await createSchedule(itemA, pointA, DATE_A, emptyToken);
    expect(denied).toBeInstanceOf(Response);
    expect((denied as Response).status).toBe(403);
    expect(await codeOf(denied as Response)).toBe('POINT_ACCESS_DENIED');
  });

  it('2. MTD conserva alcance global sujeto a RBAC', async () => {
    const me = await json<Me>(await api('GET', '/me', undefined, adminToken, ORGANIZATION_IDS.MTD));
    const org = me.organizations.find((item) => item.code === 'MTD');
    expect(org?.pointAccess.kind).toBe('global');
    const points = await json<{ items: Array<{ id: string }> }>(
      await api(
        'GET',
        '/patient-schedules/dispensing-points',
        undefined,
        adminToken,
        ORGANIZATION_IDS.MTD,
      ),
    );
    expect(points.items.map((item) => item.id)).toEqual(expect.arrayContaining([pointA, pointB]));
    const inserted = (
      await database.query<{ id: string }>(
        `insert into patient_schedules
          (authorization_item_id,planning_period_id,dispensing_point_id,commercial_code,scheduled_date,quantity,created_by,updated_by)
         values ($1,$2,$3,$4,$5,1,$6,$6) returning id`,
        [itemA, periodId, pointB, CODE, DATE_A, foundationUserId],
      )
    ).rows[0]!.id;
    scheduleIds.push(inserted);
    const visible = await api(
      'GET',
      `/patient-schedules/${inserted}`,
      undefined,
      adminToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(visible.status).toBe(200);
    const hidden = await api('GET', `/patient-schedules/${inserted}`, undefined, emptyToken);
    expect(hidden.status).toBe(403);
    expect(await codeOf(hidden)).toBe('POINT_ACCESS_DENIED');
  });

  it('3-6. grant, revoke, unicidad activa y punto inactivo no asignable', async () => {
    const granted = await json<{ grants: Array<{ dispensingPointId: string }> }>(
      await api(
        'GET',
        `/access-scopes/users/${scopeAUserId}/points`,
        undefined,
        adminToken,
        ORGANIZATION_IDS.MTD,
      ),
    );
    expect(granted.grants.map((row) => row.dispensingPointId)).toEqual([pointA]);
    const inactive = await putPoints(scopeAUserId, [pointA, inactivePoint]);
    expect(inactive.status).toBe(400);
    expect(await codeOf(inactive)).toBe('POINT_SCOPE_INACTIVE_POINT');
    const duplicate = await database
      .query(
        `insert into user_point_scopes (user_id, dispensing_point_id, granted_by)
       values ($1,$2,$3)`,
        [scopeAUserId, pointA, foundationUserId],
      )
      .catch((error: { code?: string }) => error);
    expect((duplicate as { code?: string }).code).toBe('23505');
    const revoked = await putPoints(emptyUserId, [pointA]);
    expect(revoked.status).toBe(200);
    const emptyAgain = await putPoints(emptyUserId, []);
    expect(emptyAgain.status).toBe(200);
    const remaining = await database.query<{ n: number }>(
      `select count(*)::int n from user_point_scopes where user_id=$1 and revoked_at is null`,
      [emptyUserId],
    );
    expect(remaining.rows[0]!.n).toBe(0);
  });

  it('7-11. scheduling list/get/create/reschedule/cancel respetan scope y bloquean IDOR', async () => {
    const atA = await createSchedule(itemB, pointA, DATE_A, scopeAToken);
    const atB = await createSchedule(itemC, pointB, DATE_B, scopeABToken);
    expect(atA).not.toBeInstanceOf(Response);
    expect(atB).not.toBeInstanceOf(Response);
    const listed = await json<{ items: Array<{ id: string; dispensingPointId: string }> }>(
      await api('GET', '/patient-schedules', undefined, scopeAToken),
    );
    expect(listed.items.every((item) => item.dispensingPointId === pointA)).toBe(true);
    expect(listed.items.map((item) => item.id)).toContain((atA as { id: string }).id);
    expect(listed.items.map((item) => item.id)).not.toContain((atB as { id: string }).id);
    const idor = await api(
      'GET',
      `/patient-schedules/${(atB as { id: string }).id}`,
      undefined,
      scopeAToken,
    );
    expect(idor.status).toBe(403);
    expect(await codeOf(idor)).toBe('POINT_ACCESS_DENIED');
    const createB = await createSchedule(itemD, pointB, DATE_A, scopeAToken);
    expect((createB as Response).status).toBe(403);
    const move = await api(
      'POST',
      `/patient-schedules/${(atA as { id: string }).id}/reschedule`,
      {
        expectedRevision: (atA as { revision: number }).revision,
        scheduledDate: DATE_B,
        dispensingPointId: pointB,
      },
      scopeAToken,
    );
    expect(move.status).toBe(403);
    expect(await codeOf(move)).toBe('POINT_ACCESS_DENIED');
    const cancelForeign = await api(
      'POST',
      `/patient-schedules/${(atB as { id: string }).id}/cancel`,
      { expectedRevision: (atB as { revision: number }).revision },
      scopeAToken,
    );
    expect(cancelForeign.status).toBe(403);
    const cancelOwn = await api(
      'POST',
      `/patient-schedules/${(atA as { id: string }).id}/cancel`,
      { expectedRevision: (atA as { revision: number }).revision },
      scopeAToken,
    );
    expect(cancelOwn.status).toBe(200);
  });

  it('12-14. receipts list/get/confirm derivan el punto del delivery y niegan IDOR', async () => {
    const deliveryA = await fixtureDelivery(pointA);
    const deliveryB = await fixtureDelivery(pointB);
    const createdA = await api(
      'POST',
      '/medicarte/receipts',
      { deliveryId: deliveryA.deliveryId },
      scopeAToken,
    );
    expect(createdA.status).toBe(201);
    const receiptA = await json<{ id: string; version: number }>(createdA);
    receiptIds.push(receiptA.id);
    const createdB = await api(
      'POST',
      '/medicarte/receipts',
      { deliveryId: deliveryB.deliveryId },
      scopeABToken,
    );
    expect(createdB.status).toBe(201);
    const receiptB = await json<{ id: string; version: number }>(createdB);
    receiptIds.push(receiptB.id);
    const listed = await json<{ items: Array<{ id: string }> }>(
      await api('GET', '/medicarte/receipts', undefined, scopeAToken),
    );
    expect(listed.items.map((item) => item.id)).toContain(receiptA.id);
    expect(listed.items.map((item) => item.id)).not.toContain(receiptB.id);
    const idor = await api('GET', `/medicarte/receipts/${receiptB.id}`, undefined, scopeAToken);
    expect(idor.status).toBe(403);
    expect(await codeOf(idor)).toBe('POINT_ACCESS_DENIED');
    const saved = await api(
      'PATCH',
      `/medicarte/receipts/${receiptA.id}`,
      {
        expectedVersion: receiptA.version,
        lines: [
          {
            deliveryLineId: deliveryA.deliveryLineId,
            receivedQuantity: 5,
            acceptedQuantity: 5,
            rejectedQuantity: 0,
            receivedLotNumber: deliveryA.lot,
            receivedExpirationDate: '2099-12-31',
          },
        ],
      },
      scopeAToken,
    );
    expect(saved.status).toBe(200);
    const savedBody = await json<{ version: number }>(saved);
    const confirmA = await api(
      'POST',
      `/medicarte/receipts/${receiptA.id}/confirm`,
      { expectedVersion: savedBody.version },
      scopeAToken,
    );
    expect([200, 201]).toContain(confirmA.status);
    const confirmB = await api(
      'POST',
      `/medicarte/receipts/${receiptB.id}/confirm`,
      { expectedVersion: receiptB.version },
      scopeAToken,
    );
    expect(confirmB.status).toBe(403);
  });

  it('15-17. inventory list/lot/FEFO quedan acotados al scope', async () => {
    const lotA = await insertLot(pointA);
    const lotB = await insertLot(pointB);
    const listed = await json<{ items: Array<{ id: string; dispensingPointId: string }> }>(
      await api('GET', '/inventory', undefined, scopeAToken),
    );
    expect(listed.items.every((item) => item.dispensingPointId === pointA)).toBe(true);
    expect(listed.items.map((item) => item.id)).toContain(lotA);
    expect(listed.items.map((item) => item.id)).not.toContain(lotB);
    const idor = await api('GET', `/inventory/lots/${lotB}`, undefined, scopeAToken);
    expect(idor.status).toBe(403);
    expect(await codeOf(idor)).toBe('POINT_ACCESS_DENIED');
    const fefoA = await api(
      'GET',
      `/inventory/fefo/recommendation?commercialCode=${CODE}&dispensingPointId=${pointA}`,
      undefined,
      scopeAToken,
    );
    expect(fefoA.status).toBe(200);
    const fefoB = await api(
      'GET',
      `/inventory/fefo/recommendation?commercialCode=${CODE}&dispensingPointId=${pointB}`,
      undefined,
      scopeAToken,
    );
    expect(fefoB.status).toBe(403);
  });

  it('18-19. transfer exige source AND destination y receive revalida', async () => {
    const lotA = await insertLot(pointA, 6);
    const denied = await api(
      'POST',
      '/inventory/transfers',
      {
        sourceDispensingPointId: pointA,
        destinationDispensingPointId: pointB,
        lines: [{ sourceInventoryLotId: lotA, quantity: 1 }],
      },
      scopeAToken,
    );
    expect(denied.status).toBe(403);
    expect(await codeOf(denied)).toBe('POINT_ACCESS_DENIED');
    const created = await api(
      'POST',
      '/inventory/transfers',
      {
        sourceDispensingPointId: pointA,
        destinationDispensingPointId: pointB,
        lines: [{ sourceInventoryLotId: lotA, quantity: 1 }],
      },
      scopeABToken,
    );
    expect(created.status).toBe(201);
    const transfer = await json<{ id: string; version: number }>(created);
    transferIds.push(transfer.id);
    const dispatched = await api(
      'POST',
      `/inventory/transfers/${transfer.id}/dispatch`,
      { expectedVersion: transfer.version },
      scopeABToken,
    );
    expect([200, 201]).toContain(dispatched.status);
    const dispatchedBody = await json<{ version: number; status: string }>(dispatched);
    expect((await putPoints(scopeABUserId, [pointA])).status).toBe(200);
    const receive = await api(
      'POST',
      `/inventory/transfers/${transfer.id}/receive`,
      { expectedVersion: dispatchedBody.version },
      scopeABToken,
    );
    expect(receive.status).toBe(403);
    const stillDispatched = await database.query<{ status: string }>(
      `select status from stock_transfers where id=$1`,
      [transfer.id],
    );
    expect(stillDispatched.rows[0]!.status).toBe('DISPATCHED');
    expect((await putPoints(scopeABUserId, [pointA, pointB])).status).toBe(200);
  });

  it('20-22. applications list/create/confirm respetan el punto del schedule', async () => {
    const scheduleA = await createSchedule(itemE, pointA, DATE_A, scopeAToken);
    const scheduleB = await createSchedule(itemF, pointB, DATE_B, scopeABToken);
    const lotA = await insertLot(pointA);
    const created = await api(
      'POST',
      '/medicarte/applications',
      {
        patientScheduleId: (scheduleA as { id: string }).id,
        scheduleRevision: (scheduleA as { revision: number }).revision,
        applicationDate: DATE_A,
        lines: [
          { inventoryLotId: lotA, quantity: 1, fefoOverride: true, fefoOverrideReason: 'ESP-015' },
        ],
      },
      scopeAToken,
    );
    expect(created.status).toBe(201);
    const application = await json<{ id: string; version: number }>(created);
    applicationIds.push(application.id);
    const foreign = await api(
      'POST',
      '/medicarte/applications',
      {
        patientScheduleId: (scheduleB as { id: string }).id,
        scheduleRevision: (scheduleB as { revision: number }).revision,
        applicationDate: DATE_B,
        lines: [],
      },
      scopeAToken,
    );
    expect(foreign.status).toBe(403);
    const listed = await json<{ items: Array<{ id: string }> }>(
      await api('GET', '/medicarte/applications', undefined, scopeAToken),
    );
    expect(listed.items.map((item) => item.id)).toContain(application.id);
    const confirm = await api(
      'POST',
      `/medicarte/applications/${application.id}/confirm`,
      { expectedVersion: application.version },
      scopeAToken,
    );
    expect([200, 201]).toContain(confirm.status);
  });

  it('23-25. outcomes list/NOT_APPLIED y NON_REUSABLE niegan lote fuera de punto/scope', async () => {
    const extraAuth = await insertAuthorization(`ESP015-G-${suffix}`);
    const extraB = await insertAuthorization(`ESP015-H-${suffix}`);
    const scheduleA = await createSchedule(extraAuth, pointA, DATE_A, scopeAToken);
    const scheduleB = await createSchedule(extraB, pointB, DATE_B, scopeABToken);
    const lotB = await insertLot(pointB);
    const listed = await json<{
      items: Array<{ patientScheduleId?: string; dispensingPointId?: string }>;
    }>(await api('GET', '/operational-status', undefined, scopeAToken));
    expect(
      listed.items.every((item) => !item.dispensingPointId || item.dispensingPointId === pointA),
    ).toBe(true);
    const denied = await api(
      'POST',
      `/medicarte/schedules/${(scheduleB as { id: string }).id}/not-applied`,
      {
        expectedScheduleRevision: (scheduleB as { revision: number }).revision,
        noveltyCode: 'PATIENT_NO_SHOW',
        occurredOn: DATE_B,
        preparedProductDisposition: 'NOT_PREPARED',
        nonReusableLines: [],
      },
      scopeAToken,
    );
    expect(denied.status).toBe(403);
    const mismatch = await api(
      'POST',
      `/medicarte/schedules/${(scheduleA as { id: string }).id}/not-applied`,
      {
        expectedScheduleRevision: (scheduleA as { revision: number }).revision,
        noveltyCode: 'INSUFFICIENT_STOCK',
        occurredOn: DATE_A,
        preparedProductDisposition: 'NON_REUSABLE',
        nonReusableLines: [{ inventoryLotId: lotB, quantity: 1 }],
      },
      scopeAToken,
    );
    expect([400, 409]).toContain(mismatch.status);
    expect(await codeOf(mismatch)).toBe('PATIENT_OUTCOME_POINT_MISMATCH');
    const ok = await api(
      'POST',
      `/medicarte/schedules/${(scheduleA as { id: string }).id}/not-applied`,
      {
        expectedScheduleRevision: (scheduleA as { revision: number }).revision,
        noveltyCode: 'PATIENT_NO_SHOW',
        occurredOn: DATE_A,
        preparedProductDisposition: 'NOT_PREPARED',
        nonReusableLines: [],
      },
      scopeAToken,
    );
    expect([200, 201]).toContain(ok.status);
  });

  it('26-29. bulk preview y confirm revalidan scope con éxito parcial', async () => {
    const authPreviewA = `ESP015-P1-${suffix}`;
    const authPreviewB = `ESP015-P2-${suffix}`;
    await insertAuthorization(authPreviewA);
    await insertAuthorization(authPreviewB);
    const preview = await upload(
      workbook([
        HEADER,
        row(authPreviewA, DATE_A, POINT_A_CODE),
        row(authPreviewB, DATE_B, POINT_B_CODE),
      ]),
      `esp015-preview-${suffix}.xlsx`,
      scopeAToken,
    );
    expect(preview.status).toBe(202);
    const previewJob = await json<Job>(preview);
    expect(previewJob.validRows).toBe(1);
    expect(previewJob.invalidRows).toBe(1);
    const previewRows = await json<{ items: Row[] }>(
      await api('GET', `/bulk-imports/${previewJob.id}/rows?filter=ALL`, undefined, scopeAToken),
    );
    expect(previewRows.items.find((item) => item.rowNumber === 2)?.validationStatus).toBe('VALID');
    expect(previewRows.items.find((item) => item.rowNumber === 3)?.errorCode).toBe(
      'POINT_ACCESS_DENIED',
    );
    const authConfirmA = `ESP015-C1-${suffix}`;
    const authConfirmB = `ESP015-C2-${suffix}`;
    await insertAuthorization(authConfirmA);
    await insertAuthorization(authConfirmB);
    expect((await putPoints(scopeAUserId, [pointA, pointB])).status).toBe(200);
    const ready = await json<Job>(
      await upload(
        workbook([
          HEADER,
          row(authConfirmA, DATE_A, POINT_A_CODE),
          row(authConfirmB, DATE_B, POINT_B_CODE),
        ]),
        `esp015-confirm-${suffix}.xlsx`,
        scopeAToken,
      ),
    );
    expect((await putPoints(scopeAUserId, [pointA])).status).toBe(200);
    const confirmed = await api('POST', `/bulk-imports/${ready.id}/confirm`, {}, scopeAToken);
    expect(confirmed.status).toBe(200);
    const result = await json<Job>(confirmed);
    expect(result.succeededRows).toBe(1);
    expect(result.failedRows).toBe(1);
    const executed = await json<{ items: Row[] }>(
      await api('GET', `/bulk-imports/${ready.id}/rows?filter=ALL`, undefined, scopeAToken),
    );
    const failed = executed.items.find((item) => item.rowNumber === 3);
    expect(failed?.executionStatus).toBe('FAILED');
    expect(failed?.errorCode).toBe('POINT_ACCESS_DENIED');
    const schedulesB = await database.query<{ n: number }>(
      `select count(*)::int n from patient_schedules ps
       join authorization_items ai on ai.id = ps.authorization_item_id
       where ai.numero_autorizacion = $1`,
      [authConfirmB],
    );
    expect(schedulesB.rows[0]!.n).toBe(0);
  });

  it('30-34. admin MTD grant/revoke, self-grant/OLP/Compensar 403 y audit trail', async () => {
    const manage = await putPoints(scopeAUserId, [pointA]);
    expect(manage.status).toBe(200);
    const selfGrant = await putPoints(scopeAUserId, [pointA, pointB], medicarteToken);
    expect(selfGrant.status).toBe(403);
    const olp = await putPoints(scopeAUserId, [pointA], olpToken);
    expect(olp.status).toBe(403);
    const compensar = await putPoints(scopeAUserId, [pointA], compensarToken);
    expect(compensar.status).toBe(403);
    const auditorRead = await api(
      'GET',
      `/access-scopes/users/${scopeAUserId}/points`,
      undefined,
      auditorToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(auditorRead.status).toBe(200);
    const auditorWrite = await putPoints(scopeAUserId, [pointA], auditorToken);
    expect(auditorWrite.status).toBe(403);
    const audits = await database.query<{ action: string }>(
      `select action from audit_events
        where resource_type='user_point_scope' and actor_id=$1
          and action in ('OPERATIONAL_POINT_SCOPE_GRANTED','OPERATIONAL_POINT_SCOPE_REVOKED','OPERATIONAL_POINT_SCOPE_REPLACED')
        order by occurred_at desc limit 6`,
      [foundationUserId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['OPERATIONAL_POINT_SCOPE_REPLACED']),
    );
  });

  it('35-37. bypass API deniega, el listado filtra en SQL y no hay autorización solo-frontend', async () => {
    const foreign = await createSchedule(itemD, pointB, DATE_B, scopeAToken);
    expect((foreign as Response).status).toBe(403);
    const dbCount = await database.query<{ n: number }>(
      `select count(*)::int n from patient_schedules where dispensing_point_id=$1 and planning_period_id=$2`,
      [pointB, periodId],
    );
    const listed = await json<{ items: Array<{ dispensingPointId: string }> }>(
      await api('GET', '/patient-schedules', undefined, scopeAToken),
    );
    expect(listed.items.some((item) => item.dispensingPointId === pointB)).toBe(false);
    expect(dbCount.rows[0]!.n).toBeGreaterThan(0);
  });

  it('38. revoke race: FOR SHARE bloquea el UPDATE y la mutación posterior no tiene side-effect', async () => {
    const locker = new Client({ connectionString: databaseUrl });
    const revoker = new Client({ connectionString: databaseUrl });
    await locker.connect();
    await revoker.connect();
    try {
      await locker.query('begin');
      const locked = await locker.query(
        `select id from user_point_scopes
          where user_id=$1 and dispensing_point_id=$2 and revoked_at is null
          for share`,
        [scopeAUserId, pointA],
      );
      expect(locked.rows).toHaveLength(1);
      await revoker.query('set lock_timeout = 200');
      const blocked = await revoker
        .query(
          `update user_point_scopes
              set revoked_at = now(), revoked_by = $3
            where user_id=$1 and dispensing_point_id=$2 and revoked_at is null`,
          [scopeAUserId, pointA, foundationUserId],
        )
        .catch((error: { code?: string }) => error);
      expect((blocked as { code?: string }).code).toBe('55P03');
      await locker.query('commit');
      await putPoints(scopeAUserId, []);
      const after = await createSchedule(
        await insertAuthorization(`ESP015-RACE-${suffix}`),
        pointA,
        DATE_A,
        scopeAToken,
      );
      expect((after as Response).status).toBe(403);
      expect(
        (
          await database.query<{ n: number }>(
            `select count(*)::int n from patient_schedules ps
             join authorization_items ai on ai.id = ps.authorization_item_id
             where ai.numero_autorizacion = $1`,
            [`ESP015-RACE-${suffix}`],
          )
        ).rows[0]!.n,
      ).toBe(0);
    } finally {
      await locker.query('rollback').catch(() => undefined);
      await locker.end();
      await revoker.end();
      await putPoints(scopeAUserId, [pointA]);
    }
  });

  it('39-40. revocar no reescribe historia y no hay RESERVED', async () => {
    const current = await database.query<Record<string, unknown>>(
      `select enablement_status, coverage_type, direction_status from authorization_items where id = $1`,
      [itemA],
    );
    expect(current.rows[0]).toEqual(authSnapshot);
    const reserved = await database.query<{ n: number }>(
      `select count(*)::int n from information_schema.columns
        where table_schema='public' and column_name ilike '%reserved%'`,
    );
    expect(reserved.rows[0]!.n).toBe(0);
  });

  it('41-42. analytics/export siguen RBAC MTD y Medicarte no gana acceso', async () => {
    const mtd = await api(
      'GET',
      `/analytics/operational?planningPeriodId=${periodId}`,
      undefined,
      adminToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(mtd.status).toBe(200);
    const medicarte = await api(
      'GET',
      `/analytics/operational?planningPeriodId=${periodId}`,
      undefined,
      scopeAToken,
    );
    expect(medicarte.status).toBe(403);
    const exported = await api(
      'GET',
      `/analytics/export.xlsx?planningPeriodId=${periodId}`,
      undefined,
      adminToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(exported.status).toBe(200);
    const medicarteExport = await api(
      'GET',
      `/analytics/export.xlsx?planningPeriodId=${periodId}`,
      undefined,
      scopeAToken,
    );
    expect(medicarteExport.status).toBe(403);
  });

  it('43. confirmación masiva atómica ESP-014 permanece intacta para filas autorizadas', async () => {
    const auth = `ESP015-ATOM-${suffix}`;
    await insertAuthorization(auth);
    const job = await json<Job>(
      await upload(
        workbook([HEADER, row(auth, DATE_A, POINT_A_CODE)]),
        `esp015-atom-${suffix}.xlsx`,
        scopeAToken,
      ),
    );
    const confirmed = await json<Job>(
      await api('POST', `/bulk-imports/${job.id}/confirm`, {}, scopeAToken),
    );
    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);
    const persisted = await database.query<{ n: number }>(
      `select count(*)::int n from patient_schedules ps
       join authorization_items ai on ai.id = ps.authorization_item_id
       where ai.numero_autorizacion = $1`,
      [auth],
    );
    expect(persisted.rows[0]!.n).toBe(1);
  });

  it('44 / Gate A. PostgreSQL tiene las 48 migraciones hasta 0047', async () => {
    const journal = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'packages/database/migrations/meta/_journal.json'),
        'utf8',
      ),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.length).toBeGreaterThanOrEqual(48);
    expect(journal.entries[0]?.tag).toBe('0000_foundation');
    expect(journal.entries[47]?.tag).toBe('0047_esp015_point_scopes');
    const table = await database.query<{ n: number }>(
      `select count(*)::int n from information_schema.tables where table_name='user_point_scopes'`,
    );
    expect(table.rows[0]!.n).toBe(1);
  });

  it('Gate B. ESP-015 es únicamente 0047 sobre el estado ESP-014', () => {
    const journal = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'packages/database/migrations/meta/_journal.json'),
        'utf8',
      ),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries[46]?.tag).toBe('0046_esp014_claim_fencing');
    expect(
      journal.entries.filter((entry) => entry.tag.includes('esp015')).map((entry) => entry.tag),
    ).toEqual(['0047_esp015_point_scopes']);
    const sql = readFileSync(
      resolve(process.cwd(), 'packages/database/migrations/0047_esp015_point_scopes.sql'),
      'utf8',
    );
    expect(sql).toContain('user_point_scopes');
    expect(sql).toContain('operational_scopes.manage');
    expect(sql.toLowerCase()).not.toContain('reserved');
  });
});
