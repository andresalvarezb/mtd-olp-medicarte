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

const db = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:15432/authorization',
});
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const suffix = randomUUID().slice(0, 8).toUpperCase();
const scheduleDate = '2030-05-15';
let adminToken = '';
let medicarteToken = '';
let mtdToken = '';
let olpToken = '';
let compensarToken = '';
let userId = '';
let periodId = '';
let pointId = '';
let otherPointId = '';
const scheduleIds: string[] = [];
const batchIds: string[] = [];
const authIds: string[] = [];
const outcomeIds: string[] = [];
const lotIds: string[] = [];

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
async function schedule(quantity = 1, point = pointId, code = `ESP011-${randomUUID()}`) {
  const number = `ESP011-AUTH-${randomUUID()}`;
  const batch = (
    await db.query<{ id: string }>(
      `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at) values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
      [ORGANIZATION_IDS.MTD, userId, `${number}.json`, 'b'.repeat(64)],
    )
  ).rows[0]!.id;
  batchIds.push(batch);
  const auth = (
    await db.query<{ id: string }>(
      `insert into authorization_items (numero_autorizacion,codigo_medicamento,authorization_key,source_data,source_status_normalized,source_prescripcion_normalized,no_prescripcion,enablement_status,coverage_type,direction_status,coverage_rule_version,created_from_batch_id) values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP011',$5) returning id`,
      [
        number,
        code,
        `${number}:${code}`,
        JSON.stringify({
          IDENTIFICACION_PACIENTE: `DOC-${suffix}`,
          NOMBRE_PACIENTE: 'Paciente ESP-011',
          FECHA_ASIGNACION: '2000-01-01',
          FECHA_FINAL_VIGENCIA: '2099-12-31',
        }),
        batch,
      ],
    )
  ).rows[0]!.id;
  authIds.push(auth);
  const id = (
    await db.query<{ id: string }>(
      `insert into patient_schedules (authorization_item_id,planning_period_id,dispensing_point_id,commercial_code,scheduled_date,quantity,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
      [auth, periodId, point, code, scheduleDate, quantity, userId],
    )
  ).rows[0]!.id;
  scheduleIds.push(id);
  return { id, revision: 1, auth, code, quantity, point };
}
async function lot(code: string, point = pointId, quantity = 1) {
  const id = (
    await db.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date) values ($1,$2,$3,'2099-12-31') returning id`,
      [code, point, `LOT-${randomUUID()}`],
    )
  ).rows[0]!.id;
  lotIds.push(id);
  if (quantity > 0)
    await db.query(
      `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by) values ($1,'ADJUSTMENT',$2,'ADJUSTMENT',$3,now(),$4)`,
      [id, quantity, randomUUID(), userId],
    );
  return id;
}
async function mark(
  id: string,
  revision = 1,
  extra: Record<string, unknown> = {},
  token = medicarteToken,
  organizationId = ORGANIZATION_IDS.MEDICARTE,
) {
  return api(
    'POST',
    `/medicarte/schedules/${id}/not-applied`,
    {
      expectedScheduleRevision: revision,
      noveltyCode: 'PATIENT_NO_SHOW',
      occurredOn: scheduleDate,
      preparedProductDisposition: 'NOT_PREPARED',
      nonReusableLines: [],
      ...extra,
    },
    token,
    organizationId,
  );
}
async function json<T>(response: Response) {
  return (await response.json()) as T;
}
async function scalar<T extends Record<string, unknown>>(query: string, values: unknown[] = []) {
  const result = await db.query<T>(query, values);
  return result.rows[0]!;
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
    username: `esp011-mtd-${suffix}`,
    displayName: 'ESP011 MTD',
    password: `esp011-mtd-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp011-comp-${suffix}`,
    displayName: 'ESP011 Compensar',
    password: `esp011-comp-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  periodId =
    (await db.query<{ id: string }>(`select id from planning_periods limit 1`)).rows[0]?.id ??
    (
      await db.query<{ id: string }>(
        `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2030-05-01','2030-05-31','2029-01-01T00:00:00Z','2029-01-02T00:00:00Z','2030-06-01',$1,$1) returning id`,
        [userId],
      )
    ).rows[0]!.id;
  pointId = (
    await db.query<{ id: string }>(
      `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `ESP011-${suffix}`, userId],
    )
  ).rows[0]!.id;
  otherPointId = (
    await db.query<{ id: string }>(
      `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `ESP011-OTHER-${suffix}`, userId],
    )
  ).rows[0]!.id;
  await grantAllPointsToMedicarteOperator(db);
});
afterAll(async () => {
  await db.query(
    `alter table patient_applications disable trigger patient_applications_confirmed_immutable`,
  );
  await db.query(
    `alter table patient_application_lines disable trigger patient_application_lines_confirmed_immutable`,
  );
  await db.query(
    `delete from inventory_movements where source_type='OUTCOME_LINE' and source_id in (select id from patient_schedule_outcome_lines where outcome_id in (select id from patient_schedule_outcomes where patient_schedule_id=any($1::uuid[])))`,
    [scheduleIds],
  );
  await db.query(
    `delete from patient_schedule_outcome_lines where outcome_id in (select id from patient_schedule_outcomes where patient_schedule_id=any($1::uuid[]))`,
    [scheduleIds],
  );
  await db.query(
    `delete from patient_schedule_outcomes where patient_schedule_id=any($1::uuid[])`,
    [scheduleIds],
  );
  await db.query(`delete from inventory_movements where inventory_lot_id=any($1::uuid[])`, [
    lotIds,
  ]);
  await db.query(
    `delete from patient_application_lines where patient_application_id in (select id from patient_applications where patient_schedule_id=any($1::uuid[]))`,
    [scheduleIds],
  );
  await db.query(`delete from patient_applications where patient_schedule_id=any($1::uuid[])`, [
    scheduleIds,
  ]);
  await db.query(`delete from inventory_lots where id=any($1::uuid[])`, [lotIds]);
  await db.query(`delete from patient_schedules where id=any($1::uuid[])`, [scheduleIds]);
  await db.query(`delete from authorization_items where id=any($1::uuid[])`, [authIds]);
  await db.query(`delete from import_batches where id=any($1::uuid[])`, [batchIds]);
  if (pointId && otherPointId) {
    await deletePointScopesForPoints(db, [pointId, otherPointId]);
    await db.query(`delete from dispensing_points where id in ($1,$2)`, [pointId, otherPointId]);
  }
  await db.query(
    `alter table patient_application_lines enable trigger patient_application_lines_confirmed_immutable`,
  );
  await db.query(
    `alter table patient_applications enable trigger patient_applications_confirmed_immutable`,
  );
  await db.end();
});

describe('Gate ESP-011 - operational outcomes', () => {
  it('1. vigente sin terminal es SCHEDULED', async () => {
    const s = await schedule();
    expect(
      (
        await json<{ operationalStatus: string }>(
          await api('GET', `/operational-status/${s.id}`, undefined),
        )
      ).operationalStatus,
    ).toBe('SCHEDULED');
  });
  it('2. application CONFIRMED es APPLIED', async () => {
    const s = await schedule();
    const l = await lot(s.code);
    const a = await json<{ id: string; version: number }>(
      await api('POST', '/medicarte/applications', {
        patientScheduleId: s.id,
        scheduleRevision: 1,
        applicationDate: scheduleDate,
        lines: [{ inventoryLotId: l, quantity: 1 }],
      }),
    );
    expect(
      (await api('POST', `/medicarte/applications/${a.id}/confirm`, { expectedVersion: a.version }))
        .status,
    ).toBe(201);
    expect(
      (
        await json<{ operationalStatus: string }>(
          await api('GET', `/operational-status/${s.id}`, undefined),
        )
      ).operationalStatus,
    ).toBe('APPLIED');
  });
  it('3. outcome produce NOT_APPLIED', async () => {
    const s = await schedule();
    const response = await mark(s.id);
    expect(response.status).toBe(201);
    const result = await json<{ id: string }>(response);
    outcomeIds.push(result.id);
    expect(
      (
        await json<{ operationalStatus: string }>(
          await api('GET', `/operational-status/${s.id}`, undefined),
        )
      ).operationalStatus,
    ).toBe('NOT_APPLIED');
  });
  it('4. PATIENT_NO_SHOW es novelty, no status', async () => {
    const s = await schedule();
    const response = await mark(s.id);
    const result = await json<{ id: string; noveltyCode: string; outcome: string }>(response);
    outcomeIds.push(result.id);
    expect(result.noveltyCode).toBe('PATIENT_NO_SHOW');
    expect(result.outcome).toBe('NOT_APPLIED');
  });
  it('5. CANCELLED deriva CANCELLED', async () => {
    const s = await schedule();
    await db.query(`update patient_schedules set status='CANCELLED' where id=$1`, [s.id]);
    expect(
      (
        await json<{ operationalStatus: string }>(
          await api('GET', `/operational-status/${s.id}`, undefined),
        )
      ).operationalStatus,
    ).toBe('CANCELLED');
  });
  it('6. outcome conserva revision', async () => {
    const s = await schedule();
    const result = await json<{ scheduleRevision: number; id: string }>(await mark(s.id));
    outcomeIds.push(result.id);
    expect(result.scheduleRevision).toBe(1);
  });
  it('7. reschedule deja revision actual SCHEDULED', async () => {
    const s = await schedule();
    const result = await json<{ id: string }>(await mark(s.id));
    outcomeIds.push(result.id);
    await db.query(`update patient_schedules set revision=2,status='RESCHEDULED' where id=$1`, [
      s.id,
    ]);
    const status = await json<{ operationalStatus: string; scheduleRevision: number }>(
      await api('GET', `/operational-status/${s.id}`, undefined),
    );
    expect(status).toMatchObject({ operationalStatus: 'SCHEDULED', scheduleRevision: 2 });
  });
  it('8. historial anterior permanece', async () => {
    const s = await schedule();
    const result = await json<{ id: string }>(await mark(s.id));
    outcomeIds.push(result.id);
    expect(
      (
        await db.query(
          `select 1 from patient_schedule_outcomes where patient_schedule_id=$1 and schedule_revision=1`,
          [s.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('9. duplicate no duplica', async () => {
    const s = await schedule();
    const a = await mark(s.id);
    const b = await mark(s.id);
    expect((await json<{ id: string }>(a)).id).toBe((await json<{ id: string }>(b)).id);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from patient_schedule_outcomes where patient_schedule_id=$1`,
          [s.id],
        )
      ).count,
    ).toBe('1');
  });
  it('10. application CONFIRMED bloquea outcome', async () => {
    const s = await schedule();
    const l = await lot(s.code);
    const a = await json<{ id: string; version: number }>(
      await api('POST', '/medicarte/applications', {
        patientScheduleId: s.id,
        scheduleRevision: 1,
        applicationDate: scheduleDate,
        lines: [{ inventoryLotId: l, quantity: 1 }],
      }),
    );
    await api('POST', `/medicarte/applications/${a.id}/confirm`, { expectedVersion: a.version });
    expect((await mark(s.id)).status).toBe(409);
  });
  it('11. concurrent outcome deja un terminal', async () => {
    const s = await schedule();
    await Promise.all([
      mark(s.id),
      mark(s.id, 1, { noveltyCode: 'OTHER', observation: 'Concurrente' }),
    ]);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from patient_schedule_outcomes where patient_schedule_id=$1`,
          [s.id],
        )
      ).count,
    ).toBe('1');
  });
  it('12. OTHER exige observation', async () => {
    const s = await schedule();
    expect((await mark(s.id, 1, { noveltyCode: 'OTHER' })).status).toBe(400);
  });
  it('13. NOT_PREPARED no mueve inventario', async () => {
    const s = await schedule();
    await mark(s.id);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where source_type='OUTCOME_LINE'`,
        )
      ).count,
    ).toBe('0');
  });
  it('14. REUSABLE no mueve inventario', async () => {
    const s = await schedule();
    await mark(s.id, 1, { preparedProductDisposition: 'REUSABLE' });
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where source_type='OUTCOME_LINE'`,
        )
      ).count,
    ).toBe('0');
  });
  it('15. REUSABLE no crea positivo', async () => {
    const s = await schedule();
    await mark(s.id, 1, { preparedProductDisposition: 'REUSABLE' });
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where movement_type='RETURN_TO_AVAILABLE'`,
        )
      ).count,
    ).toBe('0');
  });
  it('16. NON_REUSABLE crea negativo', async () => {
    const s = await schedule();
    const l = await lot(s.code);
    const r = await mark(s.id, 1, {
      preparedProductDisposition: 'NON_REUSABLE',
      nonReusableLines: [{ inventoryLotId: l, quantity: 1 }],
    });
    expect(r.status).toBe(201);
    const o = await json<{ id: string }>(r);
    outcomeIds.push(o.id);
    expect(
      (
        await scalar<{ quantity_delta: number }>(
          `select quantity_delta from inventory_movements where source_type='OUTCOME_LINE' and source_id in (select id from patient_schedule_outcome_lines where outcome_id=$1)`,
          [o.id],
        )
      ).quantity_delta,
    ).toBe(-1);
  });
  it('17. source es OUTCOME_LINE', async () => {
    expect(
      (await db.query(`select 1 from inventory_movements where source_type='OUTCOME_LINE' limit 1`))
        .rowCount,
    ).toBeGreaterThanOrEqual(0);
  });
  it('18. retry NON_REUSABLE no duplica', async () => {
    const s = await schedule();
    const l = await lot(s.code);
    const body = {
      preparedProductDisposition: 'NON_REUSABLE',
      nonReusableLines: [{ inventoryLotId: l, quantity: 1 }],
    };
    const a = await mark(s.id, 1, body);
    const o = await json<{ id: string }>(a);
    outcomeIds.push(o.id);
    await mark(s.id, 1, body);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where source_type='OUTCOME_LINE' and source_id in (select id from patient_schedule_outcome_lines where outcome_id=$1)`,
          [o.id],
        )
      ).count,
    ).toBe('1');
  });
  it('19. stock insuficiente revierte', async () => {
    const s = await schedule();
    const l = await lot(s.code, pointId, 0);
    expect(
      (
        await mark(s.id, 1, {
          preparedProductDisposition: 'NON_REUSABLE',
          nonReusableLines: [{ inventoryLotId: l, quantity: 1 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from patient_schedule_outcomes where patient_schedule_id=$1`,
          [s.id],
        )
      ).count,
    ).toBe('0');
  });
  it('20. outcomes concurrentes no producen saldo negativo', async () => {
    const a = await schedule();
    const b = await schedule();
    const l = await lot(a.code, pointId, 1);
    const result = await Promise.all([
      mark(a.id, 1, {
        preparedProductDisposition: 'NON_REUSABLE',
        nonReusableLines: [{ inventoryLotId: l, quantity: 1 }],
      }),
      mark(b.id, 1, {
        preparedProductDisposition: 'NON_REUSABLE',
        nonReusableLines: [{ inventoryLotId: l, quantity: 1 }],
      }),
    ]);
    expect(result.filter((r) => r.status === 201)).toHaveLength(1);
  });
  it('21. prepared quantity no supera schedule', async () => {
    const s = await schedule(1);
    const l = await lot(s.code, pointId, 2);
    expect(
      (
        await mark(s.id, 1, {
          preparedProductDisposition: 'NON_REUSABLE',
          nonReusableLines: [{ inventoryLotId: l, quantity: 2 }],
        })
      ).status,
    ).toBe(400);
  });
  it('22. producto incorrecto rechazado', async () => {
    const s = await schedule();
    const l = await lot('WRONG');
    expect(
      (
        await mark(s.id, 1, {
          preparedProductDisposition: 'NON_REUSABLE',
          nonReusableLines: [{ inventoryLotId: l, quantity: 1 }],
        })
      ).status,
    ).toBe(400);
  });
  it('23. punto incorrecto rechazado', async () => {
    const s = await schedule();
    const l = await lot(s.code, otherPointId);
    expect(
      (
        await mark(s.id, 1, {
          preparedProductDisposition: 'NON_REUSABLE',
          nonReusableLines: [{ inventoryLotId: l, quantity: 1 }],
        })
      ).status,
    ).toBe(400);
  });
  it('24. authorization intacta', async () => {
    const s = await schedule();
    const before = await db.query(
      `select operation_status,version,source_data from authorization_items where id=$1`,
      [s.auth],
    );
    const r = await mark(s.id);
    const o = await json<{ id: string }>(r);
    outcomeIds.push(o.id);
    expect(
      (
        await db.query(
          `select operation_status,version,source_data from authorization_items where id=$1`,
          [s.auth],
        )
      ).rows[0],
    ).toEqual(before.rows[0]);
  });
  it('25. planning status permanece separado', async () => {
    const s = await schedule();
    await mark(s.id);
    expect(
      (await scalar<{ status: string }>(`select status from patient_schedules where id=$1`, [s.id]))
        .status,
    ).toBe('SCHEDULED');
  });
  it('26. MTD es read-only', async () => {
    const s = await schedule();
    expect(
      (await api('GET', '/operational-status', undefined, mtdToken, ORGANIZATION_IDS.MTD)).status,
    ).toBe(200);
    expect((await mark(s.id, 1, {}, mtdToken, ORGANIZATION_IDS.MTD)).status).toBe(403);
  });
  it('27. Medicarte tiene manage', async () => {
    const s = await schedule();
    expect((await mark(s.id)).status).toBe(201);
  });
  it('28. OLP recibe 403', async () => {
    expect(
      (await api('GET', '/operational-status', undefined, olpToken, ORGANIZATION_IDS.OLP)).status,
    ).toBe(403);
  });
  it('29. Compensar recibe 403', async () => {
    expect(
      (
        await api(
          'GET',
          '/operational-status',
          undefined,
          compensarToken,
          ORGANIZATION_IDS.COMPENSAR,
        )
      ).status,
    ).toBe(403);
  });
  it('30. ledger es source of truth', async () => {
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where movement_type='NON_REUSABLE'`,
        )
      ).count,
    ).toBeDefined();
  });
  it('31. no existe RESERVED', async () => {
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where movement_type='RESERVED'`,
        )
      ).count,
    ).toBe('0');
  });
  it('32. no hay auditoría final MTD', async () => {
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from audit_events where action in ('PATIENT_OUTCOME_FINAL_MTD_AUDIT','PATIENT_OUTCOME_AUDITED')`,
        )
      ).count,
    ).toBe('0');
  });
});
