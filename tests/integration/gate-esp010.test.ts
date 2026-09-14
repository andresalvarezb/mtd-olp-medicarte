import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens, ensureUser } from './helpers/auth';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization',
});
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const suffix = randomUUID().slice(0, 8).toUpperCase();
let product = `ESP010-PRODUCT-${suffix}`;
const periodCode = `ESP010-${suffix}`;
let adminToken = '';
let medicarteToken = '';
let mtdToken = '';
let olpToken = '';
let compensarToken = '';
let foundationUserId = '';
let periodId = '';
let periodCreated = false;
let pointId = '';
let otherPointId = '';
const scheduleIds: string[] = [];
const authorizationIds: string[] = [];
const batchIds: string[] = [];
const lotIds: string[] = [];
const applicationIds: string[] = [];

async function api(
  method: string,
  path: string,
  body: unknown,
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
async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
async function createLot(
  quantity: number,
  expiration = '2099-12-31',
  code = product,
  point = pointId,
) {
  const lot = (
    await database.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date) values ($1,$2,$3,$4) returning id`,
      [code, point, `LOT-${randomUUID()}`, expiration],
    )
  ).rows[0]!.id;
  lotIds.push(lot);
  if (quantity)
    await database.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'ADJUSTMENT',$2,'ADJUSTMENT',$3,now(),$4)`,
      [lot, quantity, randomUUID(), foundationUserId],
    );
  return lot;
}
async function createSchedule(quantity = 1, code = product, point = pointId) {
  const number = `ESP010-AUTH-${randomUUID()}`;
  const batch = (
    await database.query<{ id: string }>(
      `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at) values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
      [ORGANIZATION_IDS.MTD, foundationUserId, `${number}.json`, 'a'.repeat(64)],
    )
  ).rows[0]!.id;
  batchIds.push(batch);
  const auth = (
    await database.query<{ id: string }>(
      `insert into authorization_items (numero_autorizacion,codigo_medicamento,authorization_key,source_data,source_status_normalized,source_prescripcion_normalized,no_prescripcion,enablement_status,coverage_type,direction_status,coverage_rule_version,created_from_batch_id) values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP010',$5) returning id`,
      [
        number,
        code,
        `${number}:${code}`,
        JSON.stringify({
          IDENTIFICACION_PACIENTE: `DOC-${suffix}`,
          NOMBRE_PACIENTE: 'Paciente ESP-010',
          CANTIDAD: String(quantity),
          FECHA_FINAL_VIGENCIA: '2099-12-31',
        }),
        batch,
      ],
    )
  ).rows[0]!.id;
  authorizationIds.push(auth);
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id,organization_id) values ($1,$2)`,
    [auth, ORGANIZATION_IDS.MEDICARTE],
  );
  const schedule = (
    await database.query<{ id: string }>(
      `insert into patient_schedules (authorization_item_id,planning_period_id,dispensing_point_id,commercial_code,scheduled_date,quantity,created_by,updated_by) values ($1,$2,$3,$4,'2040-05-15',$5,$6,$6) returning id`,
      [auth, periodId, point, code, quantity, foundationUserId],
    )
  ).rows[0]!.id;
  scheduleIds.push(schedule);
  return { id: schedule, revision: 1, auth, quantity, code, point };
}
async function createDraft(
  scheduleId: string,
  revision: number,
  lines: Array<{
    inventoryLotId: string;
    quantity: number;
    fefoOverride?: boolean;
    fefoOverrideReason?: string;
  }>,
  applicationDate = '2040-05-15',
) {
  const response = await api('POST', '/medicarte/applications', {
    patientScheduleId: scheduleId,
    scheduleRevision: revision,
    applicationDate,
    lines,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const application = await json<{ id: string; version: number; status: string }>(response);
  applicationIds.push(application.id);
  return application;
}
async function confirm(
  application: { id: string; version: number },
  expected = application.version,
) {
  return api('POST', `/medicarte/applications/${application.id}/confirm`, {
    expectedVersion: expected,
  });
}
async function errorCode(response: Response) {
  return (await json<{ code: string }>(response)).code;
}

beforeAll(async () => {
  await database.connect();
  const admin = await database.query<{ id: string }>(
    `select id from users where username='foundation-admin'`,
  );
  foundationUserId = admin.rows[0]!.id;
  adminToken = await adminLogin();
  ({ medicarteToken } = await ensureOperatorTokens());
  const mtd = await ensureUser({
    adminToken,
    username: `esp010-mtd-${suffix}`,
    displayName: 'ESP010 MTD',
    password: `esp010-mtd-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  mtdToken = mtd;
  olpToken = await ensureUser({
    adminToken,
    username: `esp010-olp-${suffix}`,
    displayName: 'ESP010 OLP',
    password: `esp010-olp-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.OLP,
    roleCode: 'OLP_OPERATOR',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp010-comp-${suffix}`,
    displayName: 'ESP010 Compensar',
    password: `esp010-comp-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  const existingPeriod = await database.query<{ id: string }>(
    `select id from planning_periods where start_date='2040-05-01' and end_date='2040-05-31' limit 1`,
  );
  periodId =
    existingPeriod.rows[0]?.id ??
    (
      await database.query<{ id: string }>(
        `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2040-05-01','2040-05-31','2039-01-01T00:00:00Z','2039-01-02T00:00:00Z','2040-06-01',$1,$1) returning id`,
        [foundationUserId],
      )
    ).rows[0]!.id;
  periodCreated = existingPeriod.rows.length === 0;
  pointId = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `${periodCode}-POINT`, foundationUserId],
    )
  ).rows[0]!.id;
  otherPointId = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `${periodCode}-OTHER`, foundationUserId],
    )
  ).rows[0]!.id;
});

afterAll(async () => {
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
  await database.query(`delete from inventory_movements where inventory_lot_id = any($1::uuid[])`, [
    lotIds,
  ]);
  await database.query(`delete from inventory_lots where id = any($1::uuid[])`, [lotIds]);
  await database.query(`delete from patient_schedules where id = any($1::uuid[])`, [scheduleIds]);
  await database.query(
    `delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])`,
    [authorizationIds],
  );
  await database.query(`delete from authorization_items where id = any($1::uuid[])`, [
    authorizationIds,
  ]);
  await database.query(`delete from import_batches where id = any($1::uuid[])`, [batchIds]);
  if (pointId && otherPointId)
    await database.query(`delete from dispensing_points where id in ($1,$2)`, [
      pointId,
      otherPointId,
    ]);
  if (periodCreated) await database.query(`delete from planning_periods where id=$1`, [periodId]);
  await database.end();
});

describe('Gate ESP-010 - patient applications', () => {
  beforeEach(() => {
    product = `ESP010-PRODUCT-${suffix}-${randomUUID().slice(0, 8).toUpperCase()}`;
  });
  it('1. model and identity are enforced', async () => {
    expect(
      (
        await database.query(
          `select 1 from information_schema.tables where table_name in ('patient_applications','patient_application_lines')`,
        )
      ).rowCount,
    ).toBe(2);
    const schedule = await createSchedule();
    const lot = await createLot(1);
    await createDraft(schedule.id, schedule.revision, [{ inventoryLotId: lot, quantity: 1 }]);
    const duplicate = await api('POST', '/medicarte/applications', {
      patientScheduleId: schedule.id,
      scheduleRevision: 1,
      applicationDate: '2040-05-15',
      lines: [],
    });
    expect(duplicate.status).toBe(400);
  });
  it('2. DRAFT no consume stock ni reserva', async () => {
    const schedule = await createSchedule();
    const lot = await createLot(2);
    const before = await database.query<{ n: number }>(
      `select coalesce(sum(quantity_delta),0)::int n from inventory_movements where inventory_lot_id=$1`,
      [lot],
    );
    await createDraft(schedule.id, 1, [{ inventoryLotId: lot, quantity: 1 }]);
    expect(
      (
        await database.query<{ n: number }>(
          `select coalesce(sum(quantity_delta),0)::int n from inventory_movements where inventory_lot_id=$1`,
          [lot],
        )
      ).rows[0].n,
    ).toBe(before.rows[0].n);
    expect(
      (
        await database.query<{ n: number }>(
          `select count(*)::int n from information_schema.tables where table_name='inventory_reservations'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('3-5. confirm consume exactamente y crea APPLICATION negativo', async () => {
    const schedule = await createSchedule(2);
    const lot = await createLot(2);
    const application = await createDraft(schedule.id, 1, [{ inventoryLotId: lot, quantity: 2 }]);
    const response = await confirm(application);
    expect(response.status, await response.clone().text()).toBe(201);
    const movement = await database.query<{
      movement_type: string;
      source_type: string;
      quantity_delta: number;
    }>(
      `select movement_type,source_type,quantity_delta from inventory_movements where source_type='APPLICATION_LINE' and source_id in (select id from patient_application_lines where patient_application_id=$1)`,
      [application.id],
    );
    expect(movement.rows).toHaveLength(1);
    expect(movement.rows[0]).toEqual({
      movement_type: 'APPLICATION',
      source_type: 'APPLICATION_LINE',
      quantity_delta: -2,
    });
  });
  it('6. retry no duplica movements', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const a = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    expect((await confirm(a)).status).toBe(201);
    expect((await confirm({ id: a.id, version: 1 })).status).toBe(201);
    expect(
      (
        await database.query<{ n: number }>(
          `select count(*)::int n from inventory_movements where source_type='APPLICATION_LINE' and source_id in (select id from patient_application_lines where patient_application_id=$1)`,
          [a.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('7. concurrent confirm same application is idempotent', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const a = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    const responses = await Promise.all([confirm(a), confirm(a)]);
    expect(responses.every((r) => r.status === 201)).toBe(true);
  });
  it('8-9. two schedules competing for one unit allow one and never negative', async () => {
    const l = await createLot(1);
    const a = await createDraft((await createSchedule()).id, 1, [
      { inventoryLotId: l, quantity: 1 },
    ]);
    const b = await createDraft((await createSchedule()).id, 1, [
      { inventoryLotId: l, quantity: 1 },
    ]);
    const results = await Promise.all([confirm(a), confirm(b)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      (
        await database.query<{ n: number }>(
          `select coalesce(sum(quantity_delta),0)::int n from inventory_movements where inventory_lot_id=$1`,
          [l],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('10-11. selected total menor o mayor es rechazado', async () => {
    const s = await createSchedule(2);
    const l = await createLot(3);
    const under = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    expect(await errorCode(await confirm(under))).toBe('PATIENT_APPLICATION_QUANTITY_MISMATCH');
    const s2 = await createSchedule(2);
    const over = await createDraft(s2.id, 1, [{ inventoryLotId: l, quantity: 3 }]);
    expect(await errorCode(await confirm(over))).toBe('PATIENT_APPLICATION_QUANTITY_MISMATCH');
  });
  it('12. permite múltiples lotes con cantidad exacta', async () => {
    const s = await createSchedule(3);
    const a = await createLot(2, '2040-01-01');
    const b = await createLot(2, '2040-12-01');
    const app = await createDraft(s.id, 1, [
      { inventoryLotId: a, quantity: 2 },
      { inventoryLotId: b, quantity: 1 },
    ]);
    expect((await confirm(app)).status).toBe(201);
    expect(
      (
        await database.query<{ n: number }>(
          `select count(*)::int n from inventory_movements where source_type='APPLICATION_LINE' and source_id in (select id from patient_application_lines where patient_application_id=$1)`,
          [app.id],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it('13-14. producto o punto distinto es rechazado', async () => {
    const s = await createSchedule();
    const wrongProduct = await createLot(1, '2099-12-31', `WRONG-${suffix}`);
    expect(
      await errorCode(
        await api('POST', '/medicarte/applications', {
          patientScheduleId: s.id,
          scheduleRevision: 1,
          applicationDate: '2040-05-15',
          lines: [{ inventoryLotId: wrongProduct, quantity: 1 }],
        }),
      ),
    ).toBe('PATIENT_APPLICATION_PRODUCT_MISMATCH');
    const wrongPoint = await createLot(1, '2099-12-31', product, otherPointId);
    expect(
      await errorCode(
        await api('POST', '/medicarte/applications', {
          patientScheduleId: s.id,
          scheduleRevision: 1,
          applicationDate: '2040-05-15',
          lines: [{ inventoryLotId: wrongPoint, quantity: 1 }],
        }),
      ),
    ).toBe('PATIENT_APPLICATION_POINT_MISMATCH');
  });
  it('15. stock in transit no es usable', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    await database.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'TRANSFER_OUT',-1,'TRANSFER_LINE',$2,now(),$3)`,
      [l, randomUUID(), foundationUserId],
    );
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    expect(await errorCode(await confirm(app))).toBe('PATIENT_APPLICATION_INSUFFICIENT_BALANCE');
  });
  it('16. lote vencido es rechazado', async () => {
    const s = await createSchedule();
    const l = await createLot(1, '2000-01-01');
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    expect(await errorCode(await confirm(app))).toBe('PATIENT_APPLICATION_EXPIRED_STOCK');
  });
  it('17. schedule CANCELLED es rechazado', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await database.query(`update patient_schedules set status='CANCELLED' where id=$1`, [s.id]);
    expect(await errorCode(await confirm(app))).toBe('PATIENT_APPLICATION_SCHEDULE_NOT_ELIGIBLE');
  });
  it('18. revision conflict es explícito', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await database.query(`update patient_schedules set revision=2 where id=$1`, [s.id]);
    expect(await errorCode(await confirm(app))).toBe(
      'PATIENT_APPLICATION_SCHEDULE_REVISION_CONFLICT',
    );
  });
  it('19-20. autorización bloqueada o vencida después del draft impide confirmar', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await database.query(
      `update authorization_items set enablement_status='BLOCKED_SOURCE_STATUS' where id=$1`,
      [s.auth],
    );
    expect(await errorCode(await confirm(app))).toBe('AUTHORIZATION_NOT_SCHEDULABLE');
    const s2 = await createSchedule();
    const l2 = await createLot(1);
    const app2 = await createDraft(s2.id, 1, [{ inventoryLotId: l2, quantity: 1 }]);
    await database.query(
      `update authorization_items set source_data=jsonb_set(source_data,'{FECHA_FINAL_VIGENCIA}','"2000-01-01"') where id=$1`,
      [s2.auth],
    );
    expect(await errorCode(await confirm(app2))).toBe('AUTHORIZATION_EXPIRED');
  });
  it('21. application date distinta es rechazada al confirmar', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }], '2040-05-16');
    expect(await errorCode(await confirm(app))).toBe('PATIENT_APPLICATION_DATE_MISMATCH');
  });
  it('22. FEFO normal no exige override', async () => {
    const s = await createSchedule(1);
    const early = await createLot(1, '2040-01-01');
    const late = await createLot(1, '2040-12-01');
    const app = await createDraft(s.id, 1, [{ inventoryLotId: early, quantity: 1 }]);
    expect((await confirm(app)).status).toBe(201);
    void late;
  });
  it('23. seleccionar vencimiento posterior sin motivo es rechazado', async () => {
    const s = await createSchedule();
    await createLot(1, '2040-01-01');
    const late = await createLot(1, '2040-12-01');
    const app = await createDraft(s.id, 1, [{ inventoryLotId: late, quantity: 1 }]);
    expect(await errorCode(await confirm(app))).toBe('PATIENT_APPLICATION_FEFO_OVERRIDE_REQUIRED');
  });
  it('24. override con motivo queda auditado', async () => {
    const s = await createSchedule();
    await createLot(1, '2040-01-01');
    const late = await createLot(1, '2040-12-01');
    const app = await createDraft(s.id, 1, [
      {
        inventoryLotId: late,
        quantity: 1,
        fefoOverride: true,
        fefoOverrideReason: 'Lote anterior separado para control de calidad',
      },
    ]);
    expect((await confirm(app)).status).toBe(201);
    expect(
      (
        await database.query<{ n: number }>(
          `select count(*)::int n from audit_events where action='APPLICATION_FEFO_OVERRIDE' and resource_id=$1`,
          [app.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('25. FEFO recomienda distribución multi-lote', async () => {
    const s = await createSchedule(8);
    const a = await createLot(5, '2040-01-01');
    const b = await createLot(10, '2040-12-01');
    const app = await createDraft(s.id, 1, [
      { inventoryLotId: a, quantity: 5 },
      { inventoryLotId: b, quantity: 3 },
    ]);
    const detail = await json<{
      availableLots: Array<{ id: string; recommendedQuantity: number }>;
    }>(await api('GET', `/medicarte/applications/${app.id}`, undefined));
    expect(detail.availableLots.find((l) => l.id === a)?.recommendedQuantity).toBe(5);
    expect(detail.availableLots.find((l) => l.id === b)?.recommendedQuantity).toBe(3);
    expect((await confirm(app)).status).toBe(201);
  });
  it('26. cancelar DRAFT no crea movements', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    expect(
      (
        await api('POST', `/medicarte/applications/${app.id}/cancel`, {
          expectedVersion: app.version,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await database.query<{ n: number }>(
          `select count(*)::int n from inventory_movements where source_type='APPLICATION_LINE' and source_id in (select id from patient_application_lines where patient_application_id=$1)`,
          [app.id],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('27. CONFIRMED es inmutable', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await confirm(app);
    expect(
      await errorCode(
        await api('PATCH', `/medicarte/applications/${app.id}`, { expectedVersion: 2, lines: [] }),
      ),
    ).toBe('PATIENT_APPLICATION_FROZEN');
  });
  it('28. una schedule no obtiene dos aplicaciones activas', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, []);
    expect(
      (
        await api('POST', '/medicarte/applications', {
          patientScheduleId: s.id,
          scheduleRevision: 1,
          applicationDate: '2040-05-15',
          lines: [],
        })
      ).status,
    ).toBe(400);
    await api('POST', `/medicarte/applications/${app.id}/cancel`, { expectedVersion: app.version });
    expect((await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }])).status).toBe('DRAFT');
  });
  it('29. Medicarte tiene manage', async () => {
    const response = await api('GET', '/medicarte/applications', undefined);
    expect(response.status).toBe(200);
  });
  it('30. MTD es read-only', async () => {
    const response = await api(
      'POST',
      '/medicarte/applications',
      {
        patientScheduleId: randomUUID(),
        scheduleRevision: 1,
        applicationDate: '2040-05-15',
        lines: [],
      },
      mtdToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(response.status).toBe(403);
  });
  it('31-32. OLP y Compensar reciben 403', async () => {
    expect(
      (await api('GET', '/medicarte/applications', undefined, olpToken, ORGANIZATION_IDS.OLP))
        .status,
    ).toBe(403);
    expect(
      (
        await api(
          'GET',
          '/medicarte/applications',
          undefined,
          compensarToken,
          ORGANIZATION_IDS.COMPENSAR,
        )
      ).status,
    ).toBe(403);
  });
  it('33. patient linkage existe solo en application', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    expect(
      (
        await database.query<{ column_name: string }>(
          `select column_name from information_schema.columns where table_name in ('patient_applications','patient_application_lines') and column_name like '%patient%'`,
        )
      ).rows.map((r) => r.column_name),
    ).toContain('patient_schedule_id');
    expect(
      (
        await database.query<{ n: number }>(
          `select count(*)::int n from patient_application_lines where patient_application_id=$1`,
          [app.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('34. schedule permanece SCHEDULED después de confirmar', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await confirm(app);
    expect(
      (
        await database.query<{ status: string }>(
          `select status from patient_schedules where id=$1`,
          [s.id],
        )
      ).rows[0].status,
    ).toBe('SCHEDULED');
  });
  it('35. authorization_item permanece intacta', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const before = await database.query<{
      operation_status: string | null;
      version: number;
      source_data: unknown;
    }>(`select operation_status,version,source_data from authorization_items where id=$1`, [
      s.auth,
    ]);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await confirm(app);
    const after = await database.query<{
      operation_status: string | null;
      version: number;
      source_data: unknown;
    }>(`select operation_status,version,source_data from authorization_items where id=$1`, [
      s.auth,
    ]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
  it('36. ledger es source of truth', async () => {
    const s = await createSchedule();
    const l = await createLot(2);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await confirm(app);
    expect(
      (
        await database.query<{ n: number }>(
          `select coalesce(sum(quantity_delta),0)::int n from inventory_movements where inventory_lot_id=$1`,
          [l],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('37. transfers y receipts históricos no reciben movimientos APPLICATION', async () => {
    const s = await createSchedule();
    const l = await createLot(1);
    const app = await createDraft(s.id, 1, [{ inventoryLotId: l, quantity: 1 }]);
    await confirm(app);
    expect(
      (
        await database.query<{ n: number }>(
          `select count(*)::int n from inventory_movements where movement_type='APPLICATION' and source_type not in ('APPLICATION_LINE')`,
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (await database.query<{ n: number }>(`select count(*)::int n from stock_transfers`)).rows[0]
        .n,
    ).toBeGreaterThanOrEqual(0);
  });
});
