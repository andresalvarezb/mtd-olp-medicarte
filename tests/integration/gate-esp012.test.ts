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
const scheduleDate = '2041-07-15';
let adminToken = '';
let auditorToken = '';
let operatorToken = '';
let generalToken = '';
let readOnlyToken = '';
let medicarteToken = '';
let olpToken = '';
let compensarToken = '';
let userId = '';
let periodId = '';
let periodCreated = false;
let pointId = '';
const scheduleIds: string[] = [];
const batchIds: string[] = [];
const authIds: string[] = [];
const lotIds: string[] = [];
const applicationIds: string[] = [];

type AuditItem = {
  id: string | null;
  status: string;
  patientApplicationId: string;
  patientScheduleId: string;
  scheduleRevision: number;
  operationalStatus: string;
  admissionStatus: string;
  version: number | null;
  rejectionCode: string | null;
  lines: Array<{ id: string; quantity: number }>;
  movements: Array<{ id: string; movementType: string; quantityDelta: number }>;
};

async function api(
  method: string,
  path: string,
  body?: unknown,
  token = auditorToken,
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
async function json<T>(response: Response) {
  return (await response.json()) as T;
}
async function errorCode(response: Response) {
  return (await json<{ code: string }>(response)).code;
}
async function scalar<T extends Record<string, unknown>>(query: string, values: unknown[] = []) {
  return (await db.query<T>(query, values)).rows[0]!;
}
async function schedule(quantity = 1, code = `ESP012-${randomUUID()}`) {
  const number = `ESP012-AUTH-${randomUUID()}`;
  const batch = (
    await db.query<{ id: string }>(
      `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at) values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
      [ORGANIZATION_IDS.MTD, userId, `${number}.json`, 'c'.repeat(64)],
    )
  ).rows[0]!.id;
  batchIds.push(batch);
  const auth = (
    await db.query<{ id: string }>(
      `insert into authorization_items (numero_autorizacion,codigo_medicamento,authorization_key,source_data,source_status_normalized,source_prescripcion_normalized,no_prescripcion,enablement_status,coverage_type,direction_status,coverage_rule_version,created_from_batch_id) values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP012',$5) returning id`,
      [
        number,
        code,
        `${number}:${code}`,
        JSON.stringify({
          IDENTIFICACION_PACIENTE: `DOC-${suffix}`,
          NOMBRE_PACIENTE: 'Paciente ESP-012',
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
  const id = (
    await db.query<{ id: string }>(
      `insert into patient_schedules (authorization_item_id,planning_period_id,dispensing_point_id,commercial_code,scheduled_date,quantity,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
      [auth, periodId, pointId, code, scheduleDate, quantity, userId],
    )
  ).rows[0]!.id;
  scheduleIds.push(id);
  return { id, revision: 1, auth, code, quantity };
}
async function lot(code: string, quantity = 1) {
  const id = (
    await db.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date) values ($1,$2,$3,'2099-12-31') returning id`,
      [code, pointId, `LOT-${randomUUID()}`],
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
async function draft(scheduleId: string, revision: number, inventoryLotId: string, quantity = 1) {
  const response = await api(
    'POST',
    '/medicarte/applications',
    {
      patientScheduleId: scheduleId,
      scheduleRevision: revision,
      applicationDate: scheduleDate,
      lines: [{ inventoryLotId, quantity }],
    },
    medicarteToken,
    ORGANIZATION_IDS.MEDICARTE,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const application = await json<{ id: string; version: number; status: string }>(response);
  applicationIds.push(application.id);
  return application;
}
async function confirm(application: { id: string; version: number }) {
  const response = await api(
    'POST',
    `/medicarte/applications/${application.id}/confirm`,
    { expectedVersion: application.version },
    medicarteToken,
    ORGANIZATION_IDS.MEDICARTE,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return json<{ id: string; version: number; status: string }>(response);
}
async function confirmed(quantity = 1) {
  const scheduled = await schedule(quantity);
  const inventoryLotId = await lot(scheduled.code, quantity);
  const application = await confirm(await draft(scheduled.id, 1, inventoryLotId, quantity));
  return { ...scheduled, inventoryLotId, application };
}
async function list(status?: string, token = auditorToken, organizationId = ORGANIZATION_IDS.MTD) {
  const query = status ? `?status=${status}` : '';
  return json<{ items: AuditItem[] }>(
    await api('GET', `/application-audits${query}`, undefined, token, organizationId),
  );
}
async function start(applicationId: string, token = auditorToken) {
  return api('POST', `/applications/${applicationId}/audit/start`, {}, token);
}
async function approve(id: string, version: number, token = auditorToken) {
  return api('POST', `/application-audits/${id}/approve`, { expectedVersion: version }, token);
}
async function reject(
  id: string,
  version: number,
  extra: Record<string, unknown> = {},
  token = auditorToken,
) {
  return api(
    'POST',
    `/application-audits/${id}/reject`,
    { expectedVersion: version, rejectionCode: 'SUPPORT_MISSING', ...extra },
    token,
  );
}

beforeAll(async () => {
  await db.connect();
  const admin = await db.query<{ id: string }>(
    `select id from users where username='foundation-admin'`,
  );
  userId = admin.rows[0]!.id;
  adminToken = await adminLogin();
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  auditorToken = await ensureUser({
    adminToken,
    username: `esp012-auditor-${suffix}`,
    displayName: 'ESP012 Auditor',
    password: `esp012-auditor-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_AUDITORIA',
  });
  operatorToken = await ensureUser({
    adminToken,
    username: `esp012-op-${suffix}`,
    displayName: 'ESP012 Operator',
    password: `esp012-op-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_OPERATOR',
  });
  generalToken = await ensureUser({
    adminToken,
    username: `esp012-gen-${suffix}`,
    displayName: 'ESP012 General',
    password: `esp012-gen-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  readOnlyToken = await ensureUser({
    adminToken,
    username: `esp012-ro-${suffix}`,
    displayName: 'ESP012 ReadOnly',
    password: `esp012-ro-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'READ_ONLY',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp012-comp-${suffix}`,
    displayName: 'ESP012 Compensar',
    password: `esp012-comp-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  const existingPeriod = await db.query<{ id: string }>(
    `select id from planning_periods where start_date='2041-07-01' and end_date='2041-07-31' limit 1`,
  );
  periodId =
    existingPeriod.rows[0]?.id ??
    (
      await db.query<{ id: string }>(
        `insert into planning_periods (start_date,end_date,scheduling_cutoff_at,purchase_order_deadline_at,expected_delivery_date,created_by,updated_by) values ('2041-07-01','2041-07-31','2040-01-01T00:00:00Z','2040-01-02T00:00:00Z','2041-08-01',$1,$1) returning id`,
        [userId],
      )
    ).rows[0]!.id;
  periodCreated = existingPeriod.rows.length === 0;
  pointId = (
    await db.query<{ id: string }>(
      `insert into dispensing_points (organization_id,code,name,created_by) values ($1,$2,$2,$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, `ESP012-${suffix}`, userId],
    )
  ).rows[0]!.id;
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
  if (scheduleIds.length) {
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
    await db.query(
      `delete from patient_application_lines where patient_application_id in (select id from patient_applications where patient_schedule_id=any($1::uuid[]))`,
      [scheduleIds],
    );
    await db.query(`delete from patient_applications where patient_schedule_id=any($1::uuid[])`, [
      scheduleIds,
    ]);
    await db.query(`delete from patient_schedules where id=any($1::uuid[])`, [scheduleIds]);
  }
  if (lotIds.length) {
    await db.query(`delete from inventory_movements where inventory_lot_id=any($1::uuid[])`, [
      lotIds,
    ]);
    await db.query(`delete from inventory_lots where id=any($1::uuid[])`, [lotIds]);
  }
  if (authIds.length) {
    await db.query(
      `delete from authorization_item_organizations where authorization_item_id=any($1::uuid[])`,
      [authIds],
    );
    await db.query(`delete from authorization_items where id=any($1::uuid[])`, [authIds]);
  }
  if (batchIds.length)
    await db.query(`delete from import_batches where id=any($1::uuid[])`, [batchIds]);
  if (pointId) await db.query(`delete from dispensing_points where id=$1`, [pointId]);
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

describe('Gate ESP-012 - application audits', () => {
  it('1. CONFIRMED application sin audit → READY_FOR_AUDIT', async () => {
    const item = await confirmed();
    const listed = await list('READY_FOR_AUDIT');
    expect(listed.items.some((row) => row.patientApplicationId === item.application.id)).toBe(true);
    const detail = await json<AuditItem>(
      await api('GET', `/application-audits/${item.application.id}`, undefined),
    );
    expect(detail).toMatchObject({
      id: null,
      status: 'READY_FOR_AUDIT',
      patientApplicationId: item.application.id,
      operationalStatus: 'APPLIED',
      admissionStatus: 'NOT_READY',
    });
  });

  it('2. DRAFT application no aparece READY_FOR_AUDIT', async () => {
    const scheduled = await schedule();
    const inventoryLotId = await lot(scheduled.code);
    const application = await draft(scheduled.id, 1, inventoryLotId);
    const listed = await list('READY_FOR_AUDIT');
    expect(listed.items.some((row) => row.patientApplicationId === application.id)).toBe(false);
  });

  it('3. CANCELLED application no auditable', async () => {
    const scheduled = await schedule();
    const inventoryLotId = await lot(scheduled.code);
    const application = await draft(scheduled.id, 1, inventoryLotId);
    expect(
      (
        await api(
          'POST',
          `/medicarte/applications/${application.id}/cancel`,
          { expectedVersion: application.version },
          medicarteToken,
          ORGANIZATION_IDS.MEDICARTE,
        )
      ).status,
    ).toBe(201);
    expect((await start(application.id)).status).toBe(409);
    expect(await errorCode(await start(application.id))).toBe(
      'PATIENT_APPLICATION_AUDIT_NOT_ELIGIBLE',
    );
  });

  it('4. start → IN_REVIEW', async () => {
    const item = await confirmed();
    const response = await start(item.application.id);
    expect(response.status).toBe(201);
    expect((await json<AuditItem>(response)).status).toBe('IN_REVIEW');
  });

  it('5. duplicate start no duplica', async () => {
    const item = await confirmed();
    const first = await json<AuditItem>(await start(item.application.id));
    const second = await start(item.application.id);
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe('APPLICATION_AUDIT_ALREADY_EXISTS');
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from patient_application_audits where patient_application_id=$1`,
          [item.application.id],
        )
      ).count,
    ).toBe('1');
    expect(first.id).toBeTruthy();
  });

  it('6. concurrent start → una audit', async () => {
    const item = await confirmed();
    const results = await Promise.all([start(item.application.id), start(item.application.id)]);
    expect(results.filter((row) => row.status === 201)).toHaveLength(1);
    expect(results.filter((row) => row.status === 409)).toHaveLength(1);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from patient_application_audits where patient_application_id=$1`,
          [item.application.id],
        )
      ).count,
    ).toBe('1');
  });

  it('7. approve IN_REVIEW → APPROVED', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    const response = await approve(audit.id!, audit.version!);
    expect(response.status).toBe(201);
    expect((await json<AuditItem>(response)).status).toBe('APPROVED');
  });

  it('8. approve → admission_status READY', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    const decided = await json<AuditItem>(await approve(audit.id!, audit.version!));
    expect(decided.admissionStatus).toBe('READY');
    expect(
      (
        await scalar<{ admission_status: string }>(
          `select admission_status from authorization_items where id=$1`,
          [item.auth],
        )
      ).admission_status,
    ).toBe('READY');
  });

  it('9. approval + READY atómicos', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    await approve(audit.id!, audit.version!);
    const row = await scalar<{ audit_status: string; admission_status: string }>(
      `select paa.status as audit_status, ai.admission_status
       from patient_application_audits paa
       join authorization_items ai on ai.id = paa.authorization_item_id
       where paa.id=$1`,
      [audit.id],
    );
    expect(row).toEqual({ audit_status: 'APPROVED', admission_status: 'READY' });
  });

  it('10. reject → REJECTED', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    const response = await reject(audit.id!, audit.version!);
    expect(response.status).toBe(201);
    expect((await json<AuditItem>(response)).status).toBe('REJECTED');
  });

  it('11. reject no pone READY', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    const decided = await json<AuditItem>(await reject(audit.id!, audit.version!));
    expect(decided.admissionStatus).toBe('NOT_READY');
  });

  it('12. reject conserva application CONFIRMED', async () => {
    const item = await confirmed();
    const before = await scalar<{ status: string; version: number }>(
      `select status, version from patient_applications where id=$1`,
      [item.application.id],
    );
    const audit = await json<AuditItem>(await start(item.application.id));
    await reject(audit.id!, audit.version!);
    expect(
      await scalar<{ status: string; version: number }>(
        `select status, version from patient_applications where id=$1`,
        [item.application.id],
      ),
    ).toEqual(before);
  });

  it('13. reject conserva operationalStatus APPLIED', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    await reject(audit.id!, audit.version!);
    expect(
      (
        await json<{ operationalStatus: string }>(
          await api(
            'GET',
            `/operational-status/${item.id}`,
            undefined,
            medicarteToken,
            ORGANIZATION_IDS.MEDICARTE,
          ),
        )
      ).operationalStatus,
    ).toBe('APPLIED');
  });

  it('14. reject no modifica inventory', async () => {
    const item = await confirmed();
    const before = await scalar<{ count: string }>(
      `select count(*) from inventory_movements where inventory_lot_id=$1`,
      [item.inventoryLotId],
    );
    const audit = await json<AuditItem>(await start(item.application.id));
    await reject(audit.id!, audit.version!);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where inventory_lot_id=$1`,
          [item.inventoryLotId],
        )
      ).count,
    ).toBe(before.count);
  });

  it('15. OTHER exige observation', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    expect((await reject(audit.id!, audit.version!, { rejectionCode: 'OTHER' })).status).toBe(400);
  });

  it('16. terminal APPROVED inmutable', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    const approved = await json<AuditItem>(await approve(audit.id!, audit.version!));
    expect((await reject(approved.id!, approved.version!)).status).toBe(409);
    expect((await approve(approved.id!, approved.version!)).status).toBe(409);
  });

  it('17. terminal REJECTED inmutable', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    const rejected = await json<AuditItem>(await reject(audit.id!, audit.version!));
    expect((await approve(rejected.id!, rejected.version!)).status).toBe(409);
    expect((await reject(rejected.id!, rejected.version!)).status).toBe(409);
  });

  it('18. concurrent approve/reject → un terminal', async () => {
    const item = await confirmed();
    const audit = await json<AuditItem>(await start(item.application.id));
    const results = await Promise.all([
      approve(audit.id!, audit.version!),
      reject(audit.id!, audit.version!),
    ]);
    expect(results.filter((row) => row.status === 201)).toHaveLength(1);
    expect(
      (
        await scalar<{ status: string }>(
          `select status from patient_application_audits where id=$1`,
          [audit.id],
        )
      ).status,
    ).toMatch(/APPROVED|REJECTED/);
  });

  it('19. patient schedule intacta', async () => {
    const item = await confirmed();
    const before = await scalar<{ status: string; revision: number; quantity: number }>(
      `select status, revision, quantity from patient_schedules where id=$1`,
      [item.id],
    );
    const audit = await json<AuditItem>(await start(item.application.id));
    await approve(audit.id!, audit.version!);
    expect(
      await scalar<{ status: string; revision: number; quantity: number }>(
        `select status, revision, quantity from patient_schedules where id=$1`,
        [item.id],
      ),
    ).toEqual(before);
  });

  it('20. outcome histórico intacto', async () => {
    const scheduled = await schedule();
    const marked = await api(
      'POST',
      `/medicarte/schedules/${scheduled.id}/not-applied`,
      {
        expectedScheduleRevision: 1,
        noveltyCode: 'PATIENT_NO_SHOW',
        occurredOn: scheduleDate,
        preparedProductDisposition: 'NOT_PREPARED',
        nonReusableLines: [],
      },
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(marked.status).toBe(201);
    await db.query(`update patient_schedules set revision=2,status='RESCHEDULED' where id=$1`, [
      scheduled.id,
    ]);
    const inventoryLotId = await lot(scheduled.code);
    const application = await confirm(await draft(scheduled.id, 2, inventoryLotId));
    const audit = await json<AuditItem>(await start(application.id));
    await approve(audit.id!, audit.version!);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from patient_schedule_outcomes where patient_schedule_id=$1 and schedule_revision=1`,
          [scheduled.id],
        )
      ).count,
    ).toBe('1');
  });

  it('21. application lines intactas', async () => {
    const item = await confirmed();
    const before = await db.query(
      `select id, quantity, inventory_lot_id from patient_application_lines where patient_application_id=$1 order by id`,
      [item.application.id],
    );
    const audit = await json<AuditItem>(await start(item.application.id));
    await reject(audit.id!, audit.version!);
    expect(
      (
        await db.query(
          `select id, quantity, inventory_lot_id from patient_application_lines where patient_application_id=$1 order by id`,
          [item.application.id],
        )
      ).rows,
    ).toEqual(before.rows);
  });

  it('22. APPLICATION movements intactos', async () => {
    const item = await confirmed();
    const before = await db.query(
      `select id, quantity_delta, movement_type from inventory_movements where inventory_lot_id=$1 and movement_type='APPLICATION' order by id`,
      [item.inventoryLotId],
    );
    const audit = await json<AuditItem>(await start(item.application.id));
    await approve(audit.id!, audit.version!);
    expect(
      (
        await db.query(
          `select id, quantity_delta, movement_type from inventory_movements where inventory_lot_id=$1 and movement_type='APPLICATION' order by id`,
          [item.inventoryLotId],
        )
      ).rows,
    ).toEqual(before.rows);
  });

  it('23. MTD_AUDITORIA manage', async () => {
    const item = await confirmed();
    expect((await start(item.application.id, auditorToken)).status).toBe(201);
  });

  it('24. MTD_ADMIN manage', async () => {
    const item = await confirmed();
    expect((await start(item.application.id, adminToken)).status).toBe(201);
  });

  it('25. MTD_OPERATOR read-only', async () => {
    const item = await confirmed();
    expect((await api('GET', '/application-audits', undefined, operatorToken)).status).toBe(200);
    expect((await start(item.application.id, operatorToken)).status).toBe(403);
  });

  it('26. MTD_GENERAL read-only', async () => {
    const item = await confirmed();
    expect((await api('GET', '/application-audits', undefined, generalToken)).status).toBe(200);
    expect((await start(item.application.id, generalToken)).status).toBe(403);
  });

  it('27. READ_ONLY read-only', async () => {
    const item = await confirmed();
    expect((await api('GET', '/application-audits', undefined, readOnlyToken)).status).toBe(200);
    expect((await start(item.application.id, readOnlyToken)).status).toBe(403);
  });

  it('28. Medicarte no manage', async () => {
    const item = await confirmed();
    expect(
      (
        await api(
          'POST',
          `/applications/${item.application.id}/audit/start`,
          {},
          medicarteToken,
          ORGANIZATION_IDS.MEDICARTE,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          'GET',
          '/application-audits',
          undefined,
          medicarteToken,
          ORGANIZATION_IDS.MEDICARTE,
        )
      ).status,
    ).toBe(403);
  });

  it('29. OLP 403', async () => {
    expect(
      (await api('GET', '/application-audits', undefined, olpToken, ORGANIZATION_IDS.OLP)).status,
    ).toBe(403);
  });

  it('30. Compensar 403', async () => {
    expect(
      (
        await api(
          'GET',
          '/application-audits',
          undefined,
          compensarToken,
          ORGANIZATION_IDS.COMPENSAR,
        )
      ).status,
    ).toBe(403);
  });

  it('31. READY solo puede producirse desde aprobación', async () => {
    const item = await confirmed();
    await expect(
      db.query(
        `update authorization_items set audit_status='APPROVED', admission_status='READY' where id=$1`,
        [item.auth],
      ),
    ).rejects.toThrow(/READY admission requires an approved patient application audit/);
    expect(
      (
        await scalar<{ admission_status: string }>(
          `select admission_status from authorization_items where id=$1`,
          [item.auth],
        )
      ).admission_status,
    ).toBe('NOT_READY');
  });

  it('32. no inventario nuevo', async () => {
    const item = await confirmed();
    const before = await scalar<{ count: string }>(
      `select count(*) from inventory_movements where inventory_lot_id=$1`,
      [item.inventoryLotId],
    );
    const audit = await json<AuditItem>(await start(item.application.id));
    await approve(audit.id!, audit.version!);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where inventory_lot_id=$1`,
          [item.inventoryLotId],
        )
      ).count,
    ).toBe(before.count);
    expect(
      (
        await scalar<{ count: string }>(
          `select count(*) from inventory_movements where movement_type in ('RETURN','REVERSAL') and inventory_lot_id=$1`,
          [item.inventoryLotId],
        )
      ).count,
    ).toBe('0');
  });

  it('33. no estados admission posteriores a READY', async () => {
    await expect(
      db.query(`update authorization_items set admission_status='ADMITTED' where id=$1`, [
        (await confirmed()).auth,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query(`update authorization_items set admission_status='BILLED' where id=$1`, [
        (await confirmed()).auth,
      ]),
    ).rejects.toThrow();
    await expect(
      db.query(`update authorization_items set admission_status='CLOSED' where id=$1`, [
        (await confirmed()).auth,
      ]),
    ).rejects.toThrow();
  });
});
