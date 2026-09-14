import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens, ensureUser } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8);
const AUTH_NUMBER = `ESP003-A-${suffix}`;
const AUTH_EXPIRED = `ESP003-EXP-${suffix}`;
const AUTH_BLOCKED = `ESP003-BLK-${suffix}`;
const CODE_A = `ESP3-CODE-A-${suffix.toUpperCase()}`;
const CODE_EXPIRED = `ESP3-CODE-EXP-${suffix.toUpperCase()}`;
const CODE_BLOCKED = `ESP3-CODE-BLK-${suffix.toUpperCase()}`;
const DOC_A = `DOC-A-${suffix}`;
const POINT_1_CODE = `ESP3-PT1-${suffix}`;
const POINT_2_CODE = `ESP3-PT2-${suffix}`;
const READ_ONLY_USERNAME = `esp003-readonly-${suffix}`;

const TEST_PERIOD_WINDOW = { from: '2034-01-01', to: '2034-12-31' };

let adminToken: string;
let foundationUserId: string;
let medicarteToken: string;
let olpToken: string;
let readOnlyToken: string;
let itemAId: string;
let itemExpiredId: string;
let itemBlockedId: string;
let point1Id: string;
let point2Id: string;
let periodOnTimeId: string;
let periodLateId: string;
let periodNextId: string;
let authorizationItemsBefore: number;
let itemASnapshot: Record<string, unknown>;
let onTimeScheduleId: string;
let lateScheduleId: string;
const provenanceBatchIds: string[] = [];
const patientScheduleImportIds: string[] = [];
const scheduleIds: string[] = [];

function scheduledDateIn(period: 'on-time' | 'late' | 'next'): string {
  if (period === 'on-time') return '2034-01-06';
  if (period === 'late') return '2034-02-03';
  return '2034-03-03';
}

function expirationInDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

async function apiCall(
  method: string,
  path: string,
  body: unknown,
  token: string = medicarteToken,
  organizationId: string | undefined = ORGANIZATION_IDS.MEDICARTE,
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

function xlsxBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Programacion');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function uploadImport(rows: unknown[][], filename: string): Promise<Response> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([xlsxBuffer(rows)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  );
  return fetch(`${apiUrl}/api/v1/patient-schedules/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${medicarteToken}`,
      'x-organization-id': ORGANIZATION_IDS.MEDICARTE,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
}

async function confirmImport(importId: string): Promise<Response> {
  return apiCall(
    'POST',
    `/patient-schedules/imports/${importId}/confirm`,
    {},
    medicarteToken,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countAuditEvents(resourceId: string): Promise<number> {
  const result = await database.query<{ count: number }>(
    `select count(*)::int as count from audit_events
      where resource_type = 'patient_schedule' and resource_id = $1`,
    [resourceId],
  );
  return result.rows[0]?.count ?? 0;
}

async function cleanupTestWindow(): Promise<void> {
  await database.query(
    `delete from patient_schedule_imports where original_filename like 'esp003-%'`,
  );
  await database.query(
    `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
  );
  await database.query(
    `delete from patient_schedule_history
      where patient_schedule_id in (
        select ps.id from patient_schedules ps
        join planning_periods pp on pp.id = ps.planning_period_id
        where pp.start_date between $1 and $2
      )`,
    [TEST_PERIOD_WINDOW.from, TEST_PERIOD_WINDOW.to],
  );
  await database.query(
    `delete from patient_schedules
      where planning_period_id in (
        select id from planning_periods where start_date between $1 and $2
      )`,
    [TEST_PERIOD_WINDOW.from, TEST_PERIOD_WINDOW.to],
  );
  await database.query(
    `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
  );
  await database.query(
    `delete from authorization_item_organizations
      where authorization_item_id in (
        select id from authorization_items where numero_autorizacion like 'ESP003-%'
      )`,
  );
  await database.query(
    `delete from authorization_items where numero_autorizacion like 'ESP003-%'`,
  );
  await database.query(`delete from import_batches where original_filename like 'esp003-%'`);
  await database.query(`delete from dispensing_points where code like 'ESP3-PT%'`);
  await database.query(`delete from planning_periods where start_date between $1 and $2`, [
    TEST_PERIOD_WINDOW.from,
    TEST_PERIOD_WINDOW.to,
  ]);
}

async function insertAuthorizationItem(input: {
  authorizationNumber: string;
  commercialCode: string;
  document: string;
  patientName: string;
  enablementStatus: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  expiration: string;
}): Promise<string> {
  const batch = await database.query<{ id: string }>(
    `insert into import_batches
      (organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
       processor_version, status, total_rows, confirmed_rows, completed_at, confirmed_at)
     values ($1, $2, $3, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             1, $4, 1, 'COMPLETED', 1, 1, now(), now())
     returning id`,
    [
      ORGANIZATION_IDS.MTD,
      foundationUserId,
      `esp003-${input.authorizationNumber}.xlsx`,
      'b'.repeat(64),
    ],
  );
  const createdFromBatchId = batch.rows[0]!.id;
  provenanceBatchIds.push(createdFromBatchId);
  const sourceData = {
    IDENTIFICACION_PACIENTE: input.document,
    NOMBRE_PACIENTE: input.patientName,
    CANTIDAD: '5',
    FECHA_FINAL_VIGENCIA: input.expiration,
  };
  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       created_from_batch_id)
     values ($1, $2, $3, $4::jsonb, 'VIGENTE', '', '', $5, 'PBS', 'NOT_APPLICABLE',
             'ESP003', $6)
     returning id`,
    [
      input.authorizationNumber,
      input.commercialCode,
      `${input.authorizationNumber}:${input.commercialCode}`,
      JSON.stringify(sourceData),
      input.enablementStatus,
      createdFromBatchId,
    ],
  );
  const itemId = item.rows[0]!.id;
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2) on conflict do nothing`,
    [itemId, ORGANIZATION_IDS.MEDICARTE],
  );
  return itemId;
}

beforeAll(async () => {
  await database.connect();
  const admin = await database.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );
  foundationUserId = admin.rows[0]?.id ?? '';
  if (!foundationUserId) throw new Error('Foundation admin is unavailable');

  await cleanupTestWindow();

  adminToken = await adminLogin();
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  readOnlyToken = await ensureUser({
    adminToken,
    username: READ_ONLY_USERNAME,
    displayName: 'ESP-003 Read Only',
    password: 'esp003-readonly-pw',
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'READ_ONLY',
  });

  itemAId = await insertAuthorizationItem({
    authorizationNumber: AUTH_NUMBER,
    commercialCode: CODE_A,
    document: DOC_A,
    patientName: 'Paciente ESP-003',
    enablementStatus: 'ENABLED',
    expiration: expirationInDays(10),
  });
  itemExpiredId = await insertAuthorizationItem({
    authorizationNumber: AUTH_EXPIRED,
    commercialCode: CODE_EXPIRED,
    document: `DOC-EXP-${suffix}`,
    patientName: 'Paciente Vencido',
    enablementStatus: 'ENABLED',
    expiration: expirationInDays(-5),
  });
  itemBlockedId = await insertAuthorizationItem({
    authorizationNumber: AUTH_BLOCKED,
    commercialCode: CODE_BLOCKED,
    document: `DOC-BLK-${suffix}`,
    patientName: 'Paciente Bloqueado',
    enablementStatus: 'BLOCKED_SOURCE_STATUS',
    expiration: expirationInDays(30),
  });

  const snapshot = await database.query<Record<string, unknown>>(
    `select enablement_status, operation_status, orden_compra, operational_version,
            to_char(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
            lugar_dispensacion, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
       from authorization_items where id = $1`,
    [itemAId],
  );
  itemASnapshot = snapshot.rows[0]!;
  const items = await database.query<{ count: number }>(
    `select count(*)::int as count from authorization_items`,
  );
  authorizationItemsBefore = items.rows[0]?.count ?? 0;

  const point1 = await database.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, created_by)
     values ($1, $2, 'ESP-003 Punto 1', $3) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, POINT_1_CODE, foundationUserId],
  );
  point1Id = point1.rows[0]!.id;
  const point2 = await database.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, created_by)
     values ($1, $2, 'ESP-003 Punto 2', $3) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, POINT_2_CODE, foundationUserId],
  );
  point2Id = point2.rows[0]!.id;

  const onTime = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
       expected_delivery_date, created_by, updated_by)
     values ('2034-01-04', '2034-01-10', '2034-01-05T23:59:00-05:00',
             '2034-01-06T23:59:00-05:00', '2034-01-11', $1, $1)
     returning id`,
    [foundationUserId],
  );
  periodOnTimeId = onTime.rows[0]!.id;
  const late = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
       expected_delivery_date, created_by, updated_by)
     values ('2034-02-01', '2034-02-07', '2026-01-01T00:00:00-05:00',
             '2026-01-02T00:00:00-05:00', '2034-02-08', $1, $1)
     returning id`,
    [foundationUserId],
  );
  periodLateId = late.rows[0]!.id;
  const next = await database.query<{ id: string }>(
    `insert into planning_periods
      (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
       expected_delivery_date, created_by, updated_by)
     values ('2034-03-01', '2034-03-07', '2026-01-01T00:00:00-05:00',
             '2026-01-02T00:00:00-05:00', '2034-03-08', $1, $1)
     returning id`,
    [foundationUserId],
  );
  periodNextId = next.rows[0]!.id;
});

afterAll(async () => {
  try {
    if (patientScheduleImportIds.length > 0) {
      await database.query(`delete from patient_schedule_imports where id = any($1::uuid[])`, [
        patientScheduleImportIds,
      ]);
    }
    const itemIds = [itemAId, itemExpiredId, itemBlockedId].filter(Boolean);
    if (itemIds.length > 0) {
      const schedules = await database.query<{ id: string }>(
        `select id from patient_schedules where authorization_item_id = any($1::uuid[])`,
        [itemIds],
      );
      const ids = schedules.rows.map((row) => row.id);
      if (ids.length > 0) {
        await database.query(
          `delete from demand_sources where patient_schedule_id = any($1::uuid[])`,
          [ids],
        );
        await database.query(
          `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
        );
        await database.query(
          `delete from patient_schedule_history where patient_schedule_id = any($1::uuid[])`,
          [ids],
        );
        await database.query(`delete from patient_schedules where id = any($1::uuid[])`, [ids]);
        await database.query(
          `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
        );
      }
      await database.query(
        `delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])`,
        [itemIds],
      );
      await database.query(`delete from authorization_items where id = any($1::uuid[])`, [itemIds]);
    }
    if (point1Id || point2Id) {
      await database.query(`delete from dispensing_points where id = any($1::uuid[])`, [
        [point1Id, point2Id].filter(Boolean),
      ]);
    }
    if (periodOnTimeId || periodLateId || periodNextId) {
      await database.query(`delete from planning_periods where id = any($1::uuid[])`, [
        [periodOnTimeId, periodLateId, periodNextId].filter(Boolean),
      ]);
    }
    if (provenanceBatchIds.length > 0) {
      await database.query(`delete from import_batches where id = any($1::uuid[])`, [
        provenanceBatchIds,
      ]);
    }
    await database.query(
      `delete from user_organization_roles
        where user_id in (select id from users where username = $1)`,
      [READ_ONLY_USERNAME],
    );
    await database.query(`delete from users where username = $1`, [READ_ONLY_USERNAME]);
  } finally {
    await database.end();
  }
});

describe('Gate ESP-003 — programación de pacientes', () => {
  it('1. Medicarte crea una programación válida ON_TIME con prioridad crítica', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point1Id,
      scheduledDate: scheduledDateIn('on-time'),
      quantity: 3,
    });
    expect(response.status).toBe(201);
    const schedule = (await response.json()) as {
      id: string;
      status: string;
      revision: number;
      scheduleTiming: string;
      priorityLevel: string;
      daysUntilExpiration: number;
      planningPeriodId: string;
      commercialCode: string;
    };
    onTimeScheduleId = schedule.id;
    scheduleIds.push(schedule.id);
    expect(schedule.status).toBe('SCHEDULED');
    expect(schedule.revision).toBe(1);
    expect(schedule.scheduleTiming).toBe('ON_TIME');
    expect(schedule.priorityLevel).toBe('CRITICAL');
    expect(schedule.daysUntilExpiration).toBeGreaterThan(0);
    expect(schedule.planningPeriodId).toBe(periodOnTimeId);
    expect(await countAuditEvents(schedule.id)).toBe(1);
  });

  it('2. autorización inexistente → rechazo', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: randomUUID(),
      commercialCode: CODE_A,
      dispensingPointId: point1Id,
      scheduledDate: scheduledDateIn('on-time'),
      quantity: 1,
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PATIENT_SCHEDULE_AUTHORIZATION_NOT_FOUND',
    );
  });

  it('3. producto que no pertenece a la autorización → rechazo', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: 'ESP3-NO-EXISTE',
      dispensingPointId: point1Id,
      scheduledDate: scheduledDateIn('on-time'),
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PATIENT_SCHEDULE_AUTHORIZATION_CODE_MISMATCH',
    );
  });

  it('4. cantidad <= 0 → rechazo', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point1Id,
      scheduledDate: scheduledDateIn('on-time'),
      quantity: 0,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('5. punto inexistente → rechazo', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: randomUUID(),
      scheduledDate: scheduledDateIn('on-time'),
      quantity: 1,
    });
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PATIENT_SCHEDULE_DISPENSING_POINT_NOT_FOUND',
    );
  });

  it('6. período inexistente → rechazo', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point1Id,
      scheduledDate: '2040-01-01',
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PATIENT_SCHEDULE_PERIOD_NOT_FOUND',
    );
  });

  it('rechaza autorizaciones vencidas y bloqueadas', async () => {
    const expired = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemExpiredId,
      commercialCode: CODE_EXPIRED,
      dispensingPointId: point1Id,
      scheduledDate: scheduledDateIn('on-time'),
      quantity: 1,
    });
    expect(expired.status).toBe(409);
    expect(((await expired.json()) as { code: string }).code).toBe('AUTHORIZATION_EXPIRED');

    const blocked = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemBlockedId,
      commercialCode: CODE_BLOCKED,
      dispensingPointId: point1Id,
      scheduledDate: scheduledDateIn('on-time'),
      quantity: 1,
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { code: string }).code).toBe('AUTHORIZATION_NOT_SCHEDULABLE');
  });

  it('8. programación posterior al corte → LATE con manejo explícito', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point2Id,
      scheduledDate: scheduledDateIn('late'),
      quantity: 2,
      lateHandling: 'COMPLEMENTARY_PURCHASE_ORDER',
    });
    expect(response.status).toBe(201);
    const schedule = (await response.json()) as {
      id: string;
      scheduleTiming: string;
      lateHandling: string;
      deferredPlanningPeriodId: string | null;
    };
    lateScheduleId = schedule.id;
    scheduleIds.push(schedule.id);
    expect(schedule.scheduleTiming).toBe('LATE');
    expect(schedule.lateHandling).toBe('COMPLEMENTARY_PURCHASE_ORDER');
    expect(schedule.deferredPlanningPeriodId).toBeNull();
  });

  it('9. LATE sin late_handling → rechazo', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point2Id,
      scheduledDate: scheduledDateIn('late'),
      quantity: 1,
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PATIENT_SCHEDULE_LATE_HANDLING_REQUIRED',
    );
  });

  it('5b. NEXT_PERIOD documenta el período que recibe la programación', async () => {
    // Identidad fresca: el período LATE ya tiene una programación en pt2
    // del 2034-02-03 (con OC complementaria); NEXT_PERIOD exige otra fecha.
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point2Id,
      scheduledDate: '2034-02-04',
      quantity: 1,
      lateHandling: 'NEXT_PERIOD',
    });
    expect(response.status).toBe(201);
    const schedule = (await response.json()) as {
      id: string;
      deferredPlanningPeriodId: string;
      scheduleTiming: string;
    };
    scheduleIds.push(schedule.id);
    expect(schedule.scheduleTiming).toBe('LATE');
    expect(schedule.deferredPlanningPeriodId).toBe(periodNextId);
  });

  it('5c. NEXT_PERIOD sin período siguiente → rechazo', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point2Id,
      scheduledDate: scheduledDateIn('next'),
      quantity: 1,
      lateHandling: 'NEXT_PERIOD',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      'PATIENT_SCHEDULE_NEXT_PERIOD_NOT_FOUND',
    );
  });

  it('10. reprogramación genera nueva revisión y conserva el historial', async () => {
    const response = await apiCall('POST', `/patient-schedules/${onTimeScheduleId}/reschedule`, {
      expectedRevision: 1,
      scheduledDate: '2034-01-08',
    });
    expect(response.status).toBe(200);
    const schedule = (await response.json()) as { id: string; revision: number; status: string };
    expect(schedule.revision).toBe(2);
    expect(schedule.status).toBe('RESCHEDULED');

    const history = await apiCall(
      'GET',
      `/patient-schedules/${onTimeScheduleId}/history`,
      undefined,
      medicarteToken,
    );
    const { items } = (await history.json()) as {
      items: Array<{ revision: number; changeType: string; scheduledDate: string }>;
    };
    expect(items.map((entry) => entry.revision)).toEqual([1, 2]);
    expect(items[1]).toMatchObject({
      changeType: 'RESCHEDULED',
      scheduledDate: '2034-01-08',
    });
  });

  it('11. cambio de punto genera revisión e historial', async () => {
    const response = await apiCall('PATCH', `/patient-schedules/${onTimeScheduleId}`, {
      expectedRevision: 2,
      dispensingPointId: point2Id,
    });
    expect(response.status).toBe(200);
    const schedule = (await response.json()) as { revision: number; dispensingPointId: string };
    expect(schedule.revision).toBe(3);
    expect(schedule.dispensingPointId).toBe(point2Id);

    const history = await apiCall(
      'GET',
      `/patient-schedules/${onTimeScheduleId}/history`,
      undefined,
      medicarteToken,
    );
    const { items } = (await history.json()) as {
      items: Array<{ revision: number; changeType: string; dispensingPointId: string }>;
    };
    expect(items).toHaveLength(3);
    expect(items[2]).toMatchObject({ revision: 3, changeType: 'UPDATED', dispensingPointId: point2Id });
    expect(await countAuditEvents(onTimeScheduleId)).toBe(3);
  });

  it('12. cancelación no elimina el registro y conserva historia', async () => {
    const response = await apiCall('POST', `/patient-schedules/${lateScheduleId}/cancel`, {
      expectedRevision: 1,
    });
    expect(response.status).toBe(200);
    const schedule = (await response.json()) as { id: string; status: string; revision: number };
    expect(schedule.status).toBe('CANCELLED');
    expect(schedule.revision).toBe(2);

    const row = await database.query<{ count: number }>(
      `select count(*)::int as count from patient_schedules where id = $1`,
      [lateScheduleId],
    );
    expect(row.rows[0]?.count).toBe(1);
    const history = await database.query<{ count: number }>(
      `select count(*)::int as count from patient_schedule_history
        where patient_schedule_id = $1`,
      [lateScheduleId],
    );
    expect(history.rows[0]?.count).toBe(2);

    const again = await apiCall('POST', `/patient-schedules/${lateScheduleId}/cancel`, {
      expectedRevision: 2,
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe(
      'PATIENT_SCHEDULE_INVALID_TRANSITION',
    );
  });

  it('2b. carrera: bloqueo concurrente de la autorización impide programar con estado obsoleto', async () => {
    // Transacción externa que muta (no confirma por ahora) la la fila clínica.
    const raceClient = new Client({ connectionString: databaseUrl });
    await raceClient.connect();
    try {
      await raceClient.query('begin');
      await raceClient.query(
        `update authorization_items set enablement_status = 'BLOCKED_SOURCE_STATUS' where id = $1`,
        [itemAId],
      );

      // La API se bloquea al intentar tomar el lock de la fila; cuando la
      // transacción externa confirma, la reevaluación dentro del lock lee el
      // estado nuevo y rechaza, aunque la lectura previa al lock vea ENABLED.
      const pending = apiCall('POST', '/patient-schedules', {
        authorizationItemId: itemAId,
        commercialCode: CODE_A,
        dispensingPointId: point1Id,
        scheduledDate: scheduledDateIn('on-time'),
        quantity: 1,
      });
      await sleep(150);
      await raceClient.query('commit');
      const response = await pending;
      expect(response.status).toBe(409);
      expect(((await response.json()) as { code: string }).code).toBe(
        'AUTHORIZATION_NOT_SCHEDULABLE',
      );
    } finally {
      // Restauración robusta del estado habilitado (rollback tras un commit
      // es no-op): el estado de authorization_items es invariant de la suite.
      try {
        await raceClient.query('rollback');
      } catch {
        // La transacción ya terminó (commit o error previo).
      }
      await database.query(
        `update authorization_items set enablement_status = 'ENABLED' where id = $1`,
        [itemAId],
      );
      await raceClient.end();
    }
  });

  it('13. el historial no puede modificarse (UPDATE)', async () => {
    await expect(
      database.query(
        `update patient_schedule_history set quantity = 99 where patient_schedule_id = $1`,
        [onTimeScheduleId],
      ),
    ).rejects.toThrow(/append-only/);
  });

  it('14. el historial no puede eliminarse (DELETE)', async () => {
    await expect(
      database.query(`delete from patient_schedule_history where patient_schedule_id = $1`, [
        onTimeScheduleId,
      ]),
    ).rejects.toThrow(/append-only/);
  });

  it('15. la concurrencia optimista rechaza versiones obsoletas', async () => {
    const response = await apiCall('PATCH', `/patient-schedules/${onTimeScheduleId}`, {
      expectedRevision: 1,
      quantity: 7,
    });
    expect(response.status).toBe(409);
    const payload = (await response.json()) as { code: string; fields?: unknown };
    expect(payload.code).toBe('VERSION_CONFLICT');
  });

  it('16. Medicarte puede administrar', async () => {
    const response = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point1Id,
      scheduledDate: '2034-01-10',
      quantity: 1,
    });
    expect(response.status).toBe(201);
    const schedule = (await response.json()) as { id: string };
    scheduleIds.push(schedule.id);
  });

  it('17. MTD puede leer pero no administrar', async () => {
    const list = await apiCall(
      'GET',
      '/patient-schedules',
      undefined,
      adminToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(list.status).toBe(200);
    const create = await apiCall(
      'POST',
      '/patient-schedules',
      {
        authorizationItemId: itemAId,
        commercialCode: CODE_A,
        dispensingPointId: point1Id,
        scheduledDate: '2034-01-10',
        quantity: 1,
      },
      adminToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(create.status).toBe(403);
    expect(((await create.json()) as { code: string }).code).toBe('PERMISSION_DENIED');
  });

  it('18. READ_ONLY puede leer pero no administrar', async () => {
    const list = await apiCall(
      'GET',
      '/patient-schedules',
      undefined,
      readOnlyToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(list.status).toBe(200);
    const create = await apiCall(
      'POST',
      '/patient-schedules',
      {
        authorizationItemId: itemAId,
        commercialCode: CODE_A,
        dispensingPointId: point1Id,
        scheduledDate: '2034-01-10',
        quantity: 1,
      },
      readOnlyToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(create.status).toBe(403);
  });

  it('19. OLP no puede consultar el módulo', async () => {
    const list = await apiCall(
      'GET',
      '/patient-schedules',
      undefined,
      olpToken,
      ORGANIZATION_IDS.OLP,
    );
    expect(list.status).toBe(403);
    const search = await apiCall(
      'GET',
      `/patient-schedules/authorizations?authorization=${AUTH_NUMBER}`,
      undefined,
      olpToken,
      ORGANIZATION_IDS.OLP,
    );
    expect(search.status).toBe(403);
  });

  it('20. búsqueda por autorización funciona', async () => {
    const response = await apiCall(
      'GET',
      `/patient-schedules?authorization=${AUTH_NUMBER}`,
      undefined,
      medicarteToken,
    );
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: Array<{ authorizationItemId: string }> };
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.authorizationItemId === itemAId)).toBe(true);
  });

  it('21. búsqueda por paciente funciona', async () => {
    const response = await apiCall(
      'GET',
      `/patient-schedules?patientDocument=${DOC_A}`,
      undefined,
      medicarteToken,
    );
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: Array<{ patientDocument: string }> };
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.patientDocument === DOC_A)).toBe(true);

    const search = await apiCall(
      'GET',
      `/patient-schedules/authorizations?patientDocument=${DOC_A}`,
      undefined,
      medicarteToken,
    );
    expect(search.status).toBe(200);
    const options = (await search.json()) as { items: Array<{ authorizationItemId: string }> };
    expect(options.items.map((option) => option.authorizationItemId)).toContain(itemAId);
  });

  it('22. XLSX con filas válidas se confirma transaccionalmente', async () => {
    const response = await uploadImport(
      [
        ['AUTORIZACION', 'DOCUMENTO', 'COD_COMERCIAL', 'CANTIDAD', 'PUNTO', 'FECHA_PROGRAMADA'],
        [AUTH_NUMBER, DOC_A, CODE_A, 2, POINT_2_CODE, '2034-01-07'],
      ],
      `esp003-valid-${suffix}.xlsx`,
    );
    expect(response.status).toBe(202);
    const batch = (await response.json()) as {
      id: string;
      status: string;
      totalRows: number;
      validRows: number;
      confirmedRows: number;
    };
    patientScheduleImportIds.push(batch.id);
    expect(batch.status).toBe('READY_TO_CONFIRM');
    expect(batch.totalRows).toBe(1);
    expect(batch.validRows).toBe(1);

    const rows = await apiCall(
      'GET',
      `/patient-schedules/imports/${batch.id}/rows`,
      undefined,
      medicarteToken,
    );
    expect(rows.status).toBe(200);
    const rowItems = (await rows.json()) as {
      items: Array<{ stagingStatus: string; resultCode: string; confirmable: boolean }>;
    };
    expect(rowItems.items[0]).toMatchObject({
      stagingStatus: 'VALID',
      resultCode: 'ROW_VALID',
      confirmable: true,
    });

    const confirmed = await confirmImport(batch.id);
    expect(confirmed.status).toBe(200);
    const finalized = (await confirmed.json()) as { status: string; confirmedRows: number };
    expect(finalized.status).toBe('COMPLETED');
    expect(finalized.confirmedRows).toBe(1);
  });

  it('23. XLSX mixto conserva filas no elegibles y confirma solo las válidas', async () => {
    const response = await uploadImport(
      [
        ['AUTORIZACION', 'DOCUMENTO', 'COD_COMERCIAL', 'CANTIDAD', 'PUNTO', 'FECHA_PROGRAMADA'],
        [AUTH_NUMBER, DOC_A, CODE_A, 1, POINT_1_CODE, '2034-01-09'],
        [AUTH_NUMBER, DOC_A, 'ESP3-CODIGO-INVALIDO', 1, POINT_1_CODE, '2034-01-09'],
        [AUTH_NUMBER, DOC_A, CODE_A, 1, POINT_1_CODE, '2040-01-01'],
      ],
      `esp003-mixed-${suffix}.xlsx`,
    );
    expect(response.status).toBe(202);
    const batch = (await response.json()) as {
      id: string;
      validRows: number;
      invalidRows: number;
      confirmedRows: number;
    };
    patientScheduleImportIds.push(batch.id);
    expect(batch.validRows).toBe(1);
    expect(batch.invalidRows).toBe(2);

    const confirmed = await confirmImport(batch.id);
    expect(confirmed.status).toBe(200);
    const finalized = (await confirmed.json()) as { confirmedRows: number; status: string };
    expect(finalized.confirmedRows).toBe(1);

    const rows = await apiCall(
      'GET',
      `/patient-schedules/imports/${batch.id}/rows`,
      undefined,
      medicarteToken,
    );
    const rowItems = (
      (await rows.json()) as {
        items: Array<{ stagingStatus: string; resultCode: string; patientScheduleId: string | null }>;
      }
    ).items;
    expect(rowItems.filter((row) => row.stagingStatus === 'VALID')).toHaveLength(1);
    expect(
      rowItems.filter((row) => row.stagingStatus === 'INVALID').map((row) => row.resultCode),
    ).toEqual(expect.arrayContaining(['AUTHORIZATION_CODE_MISMATCH', 'PLANNING_PERIOD_NOT_FOUND']));
    expect(rowItems.filter((row) => row.patientScheduleId !== null)).toHaveLength(1);
  });

  it('25b. identidad canónica: lotes independientes no materializan programaciones equivalentes', async () => {
    // Identidad fresca: (item A, punto 2, 2034-01-06).
    const row = [AUTH_NUMBER, DOC_A, CODE_A, 1, POINT_2_CODE, '2034-01-06'];

    const firstResponse = await uploadImport(
      [['AUTORIZACION', 'DOCUMENTO', 'COD_COMERCIAL', 'CANTIDAD', 'PUNTO', 'FECHA_PROGRAMADA'], row],
      `esp003-identity-a-${suffix}.xlsx`,
    );
    expect(firstResponse.status).toBe(202);
    const firstBatch = (await firstResponse.json()) as { id: string };
    patientScheduleImportIds.push(firstBatch.id);
    const firstConfirmed = await confirmImport(firstBatch.id);
    expect(firstConfirmed.status).toBe(200);
    const firstFinalized = (await firstConfirmed.json()) as { confirmedRows: number };
    expect(firstFinalized.confirmedRows).toBe(1);

    // Lote B, INDEPENDIENTE del lote A: misma identidad canónica.
    const secondResponse = await uploadImport(
      [['AUTORIZACION', 'DOCUMENTO', 'COD_COMERCIAL', 'CANTIDAD', 'PUNTO', 'FECHA_PROGRAMADA'], row],
      `esp003-identity-b-${suffix}.xlsx`,
    );
    expect(secondResponse.status).toBe(202);
    const secondBatch = (await secondResponse.json()) as { id: string };
    patientScheduleImportIds.push(secondBatch.id);
    const secondConfirmed = await confirmImport(secondBatch.id);
    expect(secondConfirmed.status).toBe(200);
    const secondFinalized = (await secondConfirmed.json()) as { confirmedRows: number };
    expect(secondFinalized.confirmedRows).toBe(0);

    const secondRows = await apiCall(
      'GET',
      `/patient-schedules/imports/${secondBatch.id}/rows`,
      undefined,
      medicarteToken,
    );
    const rowItems = (
      (await secondRows.json()) as {
        items: Array<{ stagingStatus: string; resultCode: string }>;
      }
    ).items;
    // El staging del lote B detecta el fingerprint equivale al schedule B
    // (already materializado por el lote A en la carga previa).
    expect(rowItems[0]).toMatchObject({
      stagingStatus: 'DUPLICATE',
      resultCode: 'DUPLICATE_EXISTING_SCHEDULE',
      confirmable: false,
    });

    // La base de datos queda con EXACTAMENTE una programación activa por identidad.
    const identity = await database.query<{ count: number }>(
      `select count(*)::int as count from patient_schedules
        where authorization_item_id = $1 and dispensing_point_id = $2
          and scheduled_date = '2034-01-06'
          and status in ('SCHEDULED', 'RESCHEDULED')`,
      [itemAId, point2Id],
    );
    expect(identity.rows[0]?.count).toBe(1);

    // El índice único parcial es la red definitiva ante escritura directa.
    await expect(
      database.query(
        `insert into patient_schedules
          (authorization_item_id, planning_period_id, dispensing_point_id, commercial_code,
           scheduled_date, quantity, created_by, updated_by)
         values ($1, $2, $3, $4, '2034-01-06', 1, $5, $5)`,
        [itemAId, periodOnTimeId, point2Id, CODE_A, foundationUserId],
      ),
    ).rejects.toThrow(/patient_schedules_active_identity_idx/);
  });

  it('25c. reprogramar sobre una identidad ya ocupada se rechaza', async () => {
    // 25b creó (item A, punto 2, 2034-01-06). Reprogramar desde otra programación
    // activa hacia esa identidad debe chocar con el índice único parcial.
    const created = await apiCall('POST', '/patient-schedules', {
      authorizationItemId: itemAId,
      commercialCode: CODE_A,
      dispensingPointId: point1Id,
      scheduledDate: '2034-01-07',
      quantity: 1,
    });
    expect(created.status).toBe(201);
    const schedule = (await created.json()) as { id: string; revision: number };
    scheduleIds.push(schedule.id);

    const attempt = await apiCall('POST', `/patient-schedules/${schedule.id}/reschedule`, {
      expectedRevision: schedule.revision,
      scheduledDate: '2034-01-06',
      dispensingPointId: point2Id,
    });
    expect(attempt.status).toBe(409);
    expect(((await attempt.json()) as { code: string }).code).toBe('PATIENT_SCHEDULE_DUPLICATE');
  });

  it('24. authorization_items queda intacto', async () => {
    const snapshot = await database.query<Record<string, unknown>>(
      `select enablement_status, operation_status, orden_compra, operational_version,
              to_char(fecha_programada, 'YYYY-MM-DD') as fecha_programada,
              lugar_dispensacion, to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
         from authorization_items where id = $1`,
      [itemAId],
    );
    expect(snapshot.rows[0]).toEqual(itemASnapshot);
    const items = await database.query<{ count: number }>(
      `select count(*)::int as count from authorization_items`,
    );
    expect(items.rows[0]?.count).toBe(authorizationItemsBefore);
  });

  it('25. todavía no se crea inventario ni recepción', async () => {
    const tables = await database.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public'
           and table_name in ('inventory', 'inventory_items', 'inventory_stock', 'receipts', 'receipt_lines')`,
    );
    expect(tables.rows).toEqual([]);
  });

  it('27. todavía no se consolidan líneas de demanda proyectada', async () => {
    const demandLines = await database.query<{ count: number }>(
      `select count(*)::int as count from projected_demand_lines
        where planning_period_id = any($1::uuid[])`,
      [[periodOnTimeId, periodLateId, periodNextId]],
    );
    expect(demandLines.rows[0]?.count).toBe(0);
    const demandSources = await database.query<{ count: number }>(
      `select count(*)::int as count from demand_sources
        where patient_schedule_id = any($1::uuid[])`,
      [scheduleIds],
    );
    expect(demandSources.rows[0]?.count).toBe(0);
  });

  it('registra auditoría de mutaciones y consulta el detalle', async () => {
    const detail = await apiCall(
      'GET',
      `/patient-schedules/${onTimeScheduleId}`,
      undefined,
      medicarteToken,
    );
    expect(detail.status).toBe(200);
    const schedule = (await detail.json()) as { revision: number; status: string };
    expect(schedule).toMatchObject({ revision: 3, status: 'RESCHEDULED' });

    const audits = await database.query<{ action: string }>(
      `select distinct action from audit_events
        where resource_type = 'patient_schedule' and resource_id = $1
        order by action`,
      [onTimeScheduleId],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'PATIENT_SCHEDULE_CREATED',
        'PATIENT_SCHEDULE_RESCHEDULED',
        'PATIENT_SCHEDULE_UPDATED',
      ]),
    );
  });

  it('expone búsqueda clínica acotada y timing preview sin duplicar la regla', async () => {
    const search = await apiCall(
      'GET',
      `/patient-schedules/authorizations?authorization=${AUTH_NUMBER}`,
      undefined,
      medicarteToken,
    );
    expect(search.status).toBe(200);
    const options = (await search.json()) as {
      items: Array<{ commercialCode: string; authorizedQuantity: number; priorityLevel: string }>;
    };
    expect(options.items[0]).toMatchObject({
      commercialCode: CODE_A,
      authorizedQuantity: 5,
      priorityLevel: 'CRITICAL',
    });

    const preview = await apiCall(
      'GET',
      '/patient-schedules/timing-preview?scheduledDate=2034-02-03',
      undefined,
      medicarteToken,
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      planningPeriodId: periodLateId,
      scheduleTiming: 'LATE',
      lateHandlingRequired: true,
      nextPlanningPeriodId: periodNextId,
    });
  });

  it('rechaza cargas XLSX de roles sin manage', async () => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([xlsxBuffer([['AUTORIZACION'], [AUTH_NUMBER]])], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `esp003-forbidden-${suffix}.xlsx`,
    );
    const response = await fetch(`${apiUrl}/api/v1/patient-schedules/imports`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORGANIZATION_IDS.MTD,
        'idempotency-key': randomUUID(),
      },
      body: form,
    });
    expect(response.status).toBe(403);
  });
});
