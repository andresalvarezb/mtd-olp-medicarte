import { execFileSync } from 'node:child_process';
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
  grantAllPointsToMedicarteOperator,
  deletePointScopesForPoints,
} from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });
const root = process.cwd();

const suffix = randomUUID().slice(0, 8);
const CODE = `ESP16-CODE-${suffix.toUpperCase()}`;
const DOC = `DOC-016-${suffix}`;
const POINT_CODE = `ESP16-PT-${suffix}`;
const PERIOD = { from: '2052-08-01', to: '2052-08-31' };
const DATE = '2052-08-12';
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

let adminToken = '';
let foundationUserId = '';
let medicarteToken = '';
let auditorToken = '';
let pointId = '';
let periodId = '';
let modernAuthId = '';
let modernAuthNumber = '';
let historicalAuthId = '';
let modernScheduleId = '';
let applicationId = '';
const lotIds: string[] = [];
const applicationIds: string[] = [];
const scheduleIds: string[] = [];
const demandIds: string[] = [];
const orderIds: string[] = [];

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function assertModernSource(relativePath: string): void {
  const text = source(relativePath);
  for (const field of [
    'lugar_dispensacion',
    'fecha_programada',
    'fecha_dispensacion',
    'fecha_aplicacion',
    'orden_compra',
    'process_status',
    'operation_status',
    'operational_version',
    'cod_autorizacion_medicarte',
  ]) {
    expect(text, `${relativePath} still references ${field}`).not.toMatch(
      new RegExp(`(^|[^A-Za-z0-9_])${field}([^A-Za-z0-9_]|$)`),
    );
  }
}

async function api(
  method: string,
  path: string,
  body?: unknown,
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

async function insertAuthorization(input: { number: string; legacy?: boolean }): Promise<string> {
  const batch = await database.query<{ id: string }>(
    `insert into import_batches (organization_id,created_by,original_filename,mime_type,size_bytes,sha256,processor_version,status,total_rows,confirmed_rows,completed_at,confirmed_at)
     values ($1,$2,$3,'application/json',1,$4,1,'COMPLETED',1,1,now(),now()) returning id`,
    [ORGANIZATION_IDS.MTD, foundationUserId, `esp016-${input.number}.json`, 'e'.repeat(64)],
  );
  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       created_from_batch_id,
       lugar_dispensacion, fecha_programada, fecha_dispensacion, fecha_aplicacion,
       cod_autorizacion_medicarte, orden_compra, process_status, operation_status)
     values ($1,$2,$3,$4::jsonb,'VIGENTE','','','ENABLED','PBS','NOT_APPLICABLE','ESP016',$5,
             $6,$7,$8,$9,$10,$11,$12,$13)
     returning id`,
    [
      input.number,
      CODE,
      `${input.number}:${CODE}`,
      JSON.stringify({
        IDENTIFICACION_PACIENTE: DOC,
        NOMBRE_PACIENTE: 'Paciente ESP-016',
        CANTIDAD: '5',
        FECHA_FINAL_VIGENCIA: '2099-12-31',
      }),
      batch.rows[0]!.id,
      input.legacy ? 'SEDE HISTORICA' : null,
      input.legacy ? '2020-01-15' : null,
      input.legacy ? '2020-01-20' : null,
      input.legacy ? '2020-01-22' : null,
      input.legacy ? 'MED-LEGACY' : null,
      input.legacy ? 'OC-LEGACY' : null,
      input.legacy ? 'PENDIENTE_DISPENSACION' : null,
      input.legacy ? 'DISPENSATION_REPORTED' : null,
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

async function insertLot(): Promise<string> {
  const lot = (
    await database.query<{ id: string }>(
      `insert into inventory_lots (commercial_code,dispensing_point_id,lot_number,expiration_date)
       values ($1,$2,$3,'2099-12-31') returning id`,
      [CODE, pointId, `ESP16-LOT-${randomUUID()}`],
    )
  ).rows[0]!.id;
  lotIds.push(lot);
  await database.query(
    `insert into inventory_movements (inventory_lot_id,movement_type,quantity_delta,source_type,source_id,occurred_at,created_by)
     values ($1,'ADJUSTMENT',5,'ADJUSTMENT',$2,now(),$3)`,
    [lot, randomUUID(), foundationUserId],
  );
  return lot;
}

function workbook(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Programacion');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(META), 'METADATA');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

beforeAll(async () => {
  await database.connect();
  adminToken = await adminLogin();
  foundationUserId = (
    await database.query<{ id: string }>(`select id from users where username='foundation-admin'`)
  ).rows[0]!.id;
  ({ medicarteToken } = await ensureOperatorTokens());
  auditorToken = await ensureUser({
    adminToken,
    username: `esp016-auditor-${suffix}`,
    displayName: 'ESP016 Auditor',
    password: `esp016-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_AUDITORIA',
  });
  pointId = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, created_by)
       values ($1,$2,'ESP-016 Punto',$3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, POINT_CODE, foundationUserId],
    )
  ).rows[0]!.id;
  periodId = (
    await database.query<{ id: string }>(
      `insert into planning_periods
        (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by)
       values ($1,$2,'2052-08-28T23:59:00-05:00','2052-08-29T23:59:00-05:00','2052-08-30',$3,$3)
       returning id`,
      [PERIOD.from, PERIOD.to, foundationUserId],
    )
  ).rows[0]!.id;
  await grantAllPointsToMedicarteOperator(database);
  modernAuthNumber = `ESP016-M-${suffix}`;
  modernAuthId = await insertAuthorization({ number: modernAuthNumber, legacy: false });
  historicalAuthId = await insertAuthorization({
    number: `ESP016-H-${suffix}`,
    legacy: true,
  });
});

afterAll(async () => {
  await database.query(
    `alter table patient_application_audits disable trigger patient_application_audits_terminal_immutable`,
  );
  await database.query(
    `alter table patient_applications disable trigger patient_applications_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_application_lines disable trigger patient_application_lines_confirmed_immutable`,
  );
  await database.query(
    `alter table patient_schedule_history disable trigger patient_schedule_history_no_delete`,
  );
  try {
    await database.query(
      `delete from bulk_import_rows where job_id in (
         select id from bulk_import_jobs where original_filename like 'esp016-%')`,
    );
    await database.query(`delete from bulk_import_jobs where original_filename like 'esp016-%'`);
    await database.query(
      `delete from patient_application_audits where patient_application_id = any($1::uuid[])`,
      [applicationIds],
    );
    await database.query(
      `delete from patient_application_lines where patient_application_id = any($1::uuid[])`,
      [applicationIds],
    );
    await database.query(`delete from patient_applications where id = any($1::uuid[])`, [
      applicationIds,
    ]);
    await database.query(
      `delete from inventory_movements where inventory_lot_id = any($1::uuid[])`,
      [lotIds],
    );
    await database.query(`delete from inventory_lots where id = any($1::uuid[])`, [lotIds]);
    await database.query(
      `delete from demand_sources where projected_demand_line_id = any($1::uuid[])`,
      [demandIds],
    );
    await database.query(`delete from projected_demand_lines where id = any($1::uuid[])`, [
      demandIds,
    ]);
    await database.query(
      `delete from purchase_order_lines where purchase_order_id = any($1::uuid[])`,
      [orderIds],
    );
    await database.query(`delete from purchase_orders where id = any($1::uuid[])`, [orderIds]);
    await database.query(
      `delete from patient_schedule_history where patient_schedule_id = any($1::uuid[])`,
      [scheduleIds],
    );
    await database.query(`delete from patient_schedules where id = any($1::uuid[])`, [scheduleIds]);
    await deletePointScopesForPoints(database, [pointId]);
    await database.query(
      `delete from authorization_item_organizations
        where authorization_item_id in (
          select id from authorization_items where numero_autorizacion like 'ESP016-%'
        )`,
    );
    await database.query(
      `delete from authorization_items where numero_autorizacion like 'ESP016-%'`,
    );
    await database.query(`delete from import_batches where original_filename like 'esp016-%'`);
    await database.query(`delete from dispensing_points where id=$1`, [pointId]);
    await database.query(`delete from planning_periods where id=$1`, [periodId]);
  } finally {
    await database.query(
      `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
    );
    await database.query(
      `alter table patient_application_lines enable trigger patient_application_lines_confirmed_immutable`,
    );
    await database.query(
      `alter table patient_applications enable trigger patient_applications_confirmed_immutable`,
    );
    await database.query(
      `alter table patient_application_audits enable trigger patient_application_audits_terminal_immutable`,
    );
    await database.end();
  }
});

describe('Gate ESP-016 — cutover de campos legacy', () => {
  it('1-8 / 16 / 27. full-runtime scan PASS; modern services do not import historical repository', () => {
    const scan = execFileSync('node', ['scripts/check-legacy-operational-usage.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(scan).toContain('LEGACY_OPERATIONAL_USAGE_CHECK=PASS');
    expect(scan).toContain('FULL_RUNTIME_LEGACY_SCAN=PASS');
    expect(scan).toContain('SCANNER_NEGATIVE_TESTS=PASS');
    expect(scan).toContain('COMPUTED_MEMBER_LEGACY_SCAN=PASS');
    expect(scan).toContain('SCHEMA_ADMISSION_BOUNDARY_SCAN=PASS');
    expect(scan).toContain(
      'SCAN_COVERAGE=API,WORKER,WEB,DOMAIN,DATABASE_RUNTIME,CONTRACTS,CONFIG,UI',
    );
    assertModernSource('apps/api/src/scheduling/patient-schedule.repository.ts');
    assertModernSource('apps/api/src/scheduling/patient-schedule.service.ts');
    assertModernSource('apps/api/src/applications/patient-application.service.ts');
    assertModernSource('apps/api/src/purchase-orders/purchase-order.repository.ts');
    assertModernSource('apps/api/src/deliveries/delivery.repository.ts');
    assertModernSource('apps/api/src/receipts/receipt.repository.ts');
    assertModernSource('apps/api/src/outcomes/patient-outcome.service.ts');
    assertModernSource('apps/api/src/analytics/analytics.repository.ts');
    assertModernSource('apps/api/src/audits/patient-application-audit.repository.ts');
    assertModernSource('apps/api/src/bulk-imports/bulk-import.service.ts');
    assertModernSource('apps/api/src/access-scopes/operational-access-scope.service.ts');
    assertModernSource('apps/worker/src/worker.service.ts');
    assertModernSource('packages/database/src/reset.ts');
    expect(source('apps/api/src/legacy/legacy-compatibility-projection.service.ts')).toContain(
      'NEW DOMAIN',
    );
    expect(source('apps/api/src/audits/patient-application-audit.repository.ts')).not.toMatch(
      /set audit_status/,
    );
    expect(source('apps/api/src/scheduling/patient-schedule.service.ts')).not.toContain(
      'LegacyAuthorizationHistoryRepository',
    );
    expect(source('apps/api/src/analytics/analytics.service.ts')).not.toContain(
      'LegacyAuthorizationHistoryRepository',
    );
    expect(source('apps/api/src/applications/patient-application.service.ts')).not.toContain(
      'LegacyAuthorizationHistoryRepository',
    );
    expect(source('apps/api/src/audits/patient-application-audit.repository.ts')).not.toContain(
      'LegacyAuthorizationHistoryRepository',
    );
    expect(source('apps/api/src/app.module.ts')).toContain('LegacyAuthorizationHistoryRepository');
  });

  it('9 / 19-23. modern workflow con columnas legacy NULL: schedule → demand → PO → application → audit READY → analytics', async () => {
    const legacy = await database.query<{
      fecha_aplicacion: string | null;
      orden_compra: string | null;
      lugar_dispensacion: string | null;
    }>(
      `select to_char(fecha_aplicacion,'YYYY-MM-DD') as fecha_aplicacion, orden_compra, lugar_dispensacion
         from authorization_items where id=$1`,
      [modernAuthId],
    );
    expect(legacy.rows[0]).toEqual({
      fecha_aplicacion: null,
      orden_compra: null,
      lugar_dispensacion: null,
    });

    const created = await api('POST', '/patient-schedules', {
      authorizationItemId: modernAuthId,
      commercialCode: CODE,
      dispensingPointId: pointId,
      scheduledDate: DATE,
      quantity: 1,
    });
    expect(created.status).toBe(201);
    const schedule = await json<{ id: string; revision: number }>(created);
    modernScheduleId = schedule.id;
    scheduleIds.push(schedule.id);

    const demand = await database.query<{ id: string }>(
      `insert into projected_demand_lines
        (planning_period_id, dispensing_point_id, commercial_code, projected_quantity,
         regular_quantity, late_quantity, created_by, updated_by)
       values ($1,$2,$3,1,1,0,$4,$4) returning id`,
      [periodId, pointId, CODE, foundationUserId],
    );
    demandIds.push(demand.rows[0]!.id);
    const order = await database.query<{ id: string }>(
      `insert into purchase_orders
        (planning_period_id, order_type, status, created_by, updated_by)
       values ($1,'STANDARD','DRAFT',$2,$2) returning id`,
      [periodId, foundationUserId],
    );
    orderIds.push(order.rows[0]!.id);

    const lotId = await insertLot();
    const draft = await api('POST', '/medicarte/applications', {
      patientScheduleId: schedule.id,
      scheduleRevision: schedule.revision,
      applicationDate: DATE,
      lines: [
        { inventoryLotId: lotId, quantity: 1, fefoOverride: true, fefoOverrideReason: 'ESP-016' },
      ],
    });
    expect(draft.status).toBe(201);
    const application = await json<{ id: string; version: number }>(draft);
    applicationId = application.id;
    applicationIds.push(application.id);
    const confirm = await api('POST', `/medicarte/applications/${application.id}/confirm`, {
      expectedVersion: application.version,
    });
    expect([200, 201]).toContain(confirm.status);

    const started = await api(
      'POST',
      `/applications/${application.id}/audit/start`,
      {},
      auditorToken,
      ORGANIZATION_IDS.MTD,
    );
    expect([200, 201]).toContain(started.status);
    const startedBody = await json<{ id: string; version: number; status: string }>(started);
    const approved = await api(
      'POST',
      `/application-audits/${startedBody.id}/approve`,
      { expectedVersion: startedBody.version },
      auditorToken,
      ORGANIZATION_IDS.MTD,
    );
    expect([200, 201]).toContain(approved.status);
    const decided = await json<{ admissionStatus: string; status: string }>(approved);
    expect(decided.status).toBe('APPROVED');
    expect(decided.admissionStatus).toBe('READY');

    const item = await database.query<{
      audit_status: string;
      admission_status: string;
      fecha_aplicacion: string | null;
    }>(
      `select audit_status, admission_status, to_char(fecha_aplicacion,'YYYY-MM-DD') as fecha_aplicacion
         from authorization_items where id=$1`,
      [modernAuthId],
    );
    expect(item.rows[0]).toEqual({
      audit_status: 'APPROVED',
      admission_status: 'READY',
      fecha_aplicacion: null,
    });

    const analytics = await api(
      'GET',
      `/analytics/operational?planningPeriodId=${periodId}`,
      undefined,
      auditorToken,
      ORGANIZATION_IDS.MTD,
    );
    expect(analytics.status).toBe(200);
  });

  it('10-15 / 24. mutar campos legacy no cambia el dominio moderno; proyección unidireccional', async () => {
    const applicationsBefore = await database.query<{ n: number }>(
      `select count(*)::int n from patient_applications where authorization_item_id=$1`,
      [modernAuthId],
    );
    const ordersBefore = await database.query<{ n: number }>(
      `select count(*)::int n from purchase_orders where id = any($1::uuid[])`,
      [orderIds],
    );
    const revisionBefore = await database.query<{ revision: number }>(
      `select revision from patient_schedules where id=$1`,
      [modernScheduleId],
    );
    await database.query(
      `update authorization_items
          set fecha_aplicacion = current_date,
              orden_compra = 'FAKE-OC',
              process_status = 'AUDITORIA_APROBADA',
              operation_status = 'EXPIRED',
              operational_version = operational_version + 9,
              fecha_programada = '1999-01-01',
              lugar_dispensacion = 'OTRO PUNTO',
              fecha_dispensacion = current_date
        where id=$1`,
      [modernAuthId],
    );
    const applicationsAfter = await database.query<{ n: number }>(
      `select count(*)::int n from patient_applications where authorization_item_id=$1`,
      [modernAuthId],
    );
    expect(applicationsAfter.rows[0]!.n).toBe(applicationsBefore.rows[0]!.n);
    const listed = await json<{ items: Array<{ applicationDate: string }> }>(
      await api('GET', '/medicarte/applications'),
    );
    expect(listed.items.some((item) => item.applicationDate === DATE)).toBe(true);
    const ordersAfter = await database.query<{ n: number }>(
      `select count(*)::int n from purchase_orders where id = any($1::uuid[])`,
      [orderIds],
    );
    expect(ordersAfter.rows[0]!.n).toBe(ordersBefore.rows[0]!.n);
    const revisionAfter = await database.query<{ revision: number; scheduled_date: string }>(
      `select revision, scheduled_date::text as scheduled_date from patient_schedules where id=$1`,
      [modernScheduleId],
    );
    expect(revisionAfter.rows[0]!.revision).toBe(revisionBefore.rows[0]!.revision);
    expect(revisionAfter.rows[0]!.scheduled_date).toBe(DATE);

    const historicalItem = await database.query(
      `update authorization_items set audit_status='APPROVED' where id=$1`,
      [historicalAuthId],
    );
    expect(historicalItem.rowCount).toBe(1);
    const invented = await database.query<{ n: number }>(
      `select count(*)::int n from patient_application_audits where authorization_item_id=$1`,
      [historicalAuthId],
    );
    expect(invented.rows[0]!.n).toBe(0);
    const admission = await database.query<{ admission_status: string }>(
      `select admission_status from authorization_items where id=$1`,
      [historicalAuthId],
    );
    expect(admission.rows[0]!.admission_status).toBe('NOT_READY');
    const audits = await json<{ items: Array<{ authorizationItemId: string; status: string }> }>(
      await api(
        'GET',
        '/application-audits?status=APPROVED',
        undefined,
        auditorToken,
        ORGANIZATION_IDS.MTD,
      ),
    );
    expect(audits.items.every((item) => item.authorizationItemId !== historicalAuthId)).toBe(true);

    const modernAudit = await database.query<{ status: string }>(
      `select status from patient_application_audits where patient_application_id=$1`,
      [applicationId],
    );
    expect(modernAudit.rows[0]!.status).toBe('APPROVED');
    const observableMismatch = await database.query<{ n: number }>(
      `select count(*)::int n from authorization_items ai
        where ai.id=$1 and ai.audit_status='APPROVED'
          and not exists (
            select 1 from patient_application_audits paa
             where paa.authorization_item_id = ai.id and paa.status='APPROVED'
          )`,
      [historicalAuthId],
    );
    expect(observableMismatch.rows[0]!.n).toBe(1);
  });

  it('17-18 / 40. historical-only se lee y no fabrica lineage moderno', async () => {
    const history = await database.query<{
      lugar_dispensacion: string | null;
      orden_compra: string | null;
      fecha_aplicacion: string | null;
    }>(
      `select lugar_dispensacion, orden_compra, to_char(fecha_aplicacion,'YYYY-MM-DD') as fecha_aplicacion
         from authorization_items where id=$1`,
      [historicalAuthId],
    );
    expect(history.rows[0]?.lugar_dispensacion).toBe('SEDE HISTORICA');
    expect(history.rows[0]?.orden_compra).toBe('OC-LEGACY');
    const schedules = await database.query<{ n: number }>(
      `select count(*)::int n from patient_schedules where authorization_item_id=$1`,
      [historicalAuthId],
    );
    expect(schedules.rows[0]!.n).toBe(0);
    const applications = await database.query<{ n: number }>(
      `select count(*)::int n from patient_applications where authorization_item_id=$1`,
      [historicalAuthId],
    );
    expect(applications.rows[0]!.n).toBe(0);
  });

  it('21-22. bulk y point scope usan fuentes modernas', async () => {
    const bulkAuth = `ESP016-B-${suffix}`;
    await insertAuthorization({ number: bulkAuth, legacy: false });
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(workbook([HEADER, [bulkAuth, DOC, CODE, 1, POINT_CODE, DATE]]))], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `esp016-bulk-${suffix}.xlsx`,
    );
    const upload = await fetch(`${apiUrl}/api/v1/bulk-imports/scheduling/upload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${medicarteToken}`,
        'x-organization-id': ORGANIZATION_IDS.MEDICARTE,
      },
      body: form,
    });
    expect(upload.status).toBe(202);
    const job = await json<{ id: string; validRows: number }>(upload);
    expect(job.validRows).toBe(1);
    const scopes = await database.query<{ n: number }>(
      `select count(*)::int n from user_point_scopes
        where dispensing_point_id=$1 and revoked_at is null`,
      [pointId],
    );
    expect(scopes.rows[0]!.n).toBeGreaterThan(0);
  });

  it('25-26. no RESERVED y no hay segunda fuente de verdad operacional', () => {
    expect(source('apps/api/src/legacy/legacy-compatibility-projection.service.ts')).not.toContain(
      'RESERVED',
    );
    expect(source('packages/domain/src/legacy-operational-cutover.ts')).toContain(
      'NEW_DOMAIN_TO_LEGACY',
    );
    expect(source('packages/domain/src/legacy-operational-cutover.ts')).toContain(
      'patient_application_audits',
    );
  });

  it('Gate A. PostgreSQL tiene las 49 migraciones hasta 0048', async () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    expect(journal.entries.length).toBeGreaterThanOrEqual(49);
    expect(journal.entries[0]?.tag).toBe('0000_foundation');
    expect(journal.entries[48]?.tag).toBe('0048_esp016_legacy_cutover');
    const comment = await database.query<{ description: string }>(
      `select col_description('authorization_items'::regclass, attnum) as description
         from pg_attribute
        where attrelid='authorization_items'::regclass and attname='audit_status'`,
    );
    expect(comment.rows[0]?.description).toContain('DERIVED_COMPATIBILITY');
  });

  it('Gate B. ESP-016 es únicamente 0048 sobre el estado ESP-015', () => {
    const journal = JSON.parse(
      readFileSync(resolve(root, 'packages/database/migrations/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries[47]?.tag).toBe('0047_esp015_point_scopes');
    expect(
      journal.entries.filter((entry) => entry.tag.includes('esp016')).map((entry) => entry.tag),
    ).toEqual(['0048_esp016_legacy_cutover']);
    const sql = readFileSync(
      resolve(root, 'packages/database/migrations/0048_esp016_legacy_cutover.sql'),
      'utf8',
    );
    expect(sql).toContain('COMMENT ON COLUMN');
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});
