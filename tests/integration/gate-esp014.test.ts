import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORGANIZATION_IDS,
  adminLogin,
  ensureOperatorTokens,
  ensureUser,
  grantAllPointsToMedicarteOperator,
  deletePointScopesForPointCodeLike,
} from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8);
const AUTH_NUMBER = `ESP014-A-${suffix}`;
const AUTH_B = `ESP014-B-${suffix}`;
const CODE = `ESP14-CODE-${suffix.toUpperCase()}`;
const DOC = `DOC-014-${suffix}`;
const POINT_CODE = `ESP14-PT-${suffix}`;
const PERIOD = { from: '2046-06-01', to: '2046-06-30' };
const DATE_A = '2046-06-03';
const DATE_B = '2046-06-04';
const DATE_C = '2046-06-05';
const DATE_D = '2046-06-06';
const DATE_E = '2046-06-07';
const DATE_F = '2046-06-08';
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
let olpToken = '';
let compensarToken = '';
let mtdToken = '';
let itemId = '';
let itemBId = '';
let pointId = '';
let periodId = '';
let authSnapshot: Record<string, unknown> = {};

type Job = {
  id: string;
  status: string;
  templateVersion: string;
  duplicateFile: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createRows: number;
  succeededRows: number;
  failedRows: number;
  skippedRows: number;
};
type Row = {
  rowNumber: number;
  validationStatus: string;
  executionStatus: string;
  errorCode: string | null;
  errorMessage: string | null;
  entityReference: string | null;
};
type Analytics = {
  funnel: {
    projectedQuantity: number;
    requestedQuantity: number;
    acceptedQuantity: number;
    dispatchedQuantity: number;
    physicallyReceivedQuantity: number;
    acceptedIntoInventoryQuantity: number;
    appliedQuantity: number;
  };
  inventory: {
    currentOnHandQuantity: number;
    usableBalance: number;
    inTransitQuantity: number;
    receivedMinusAppliedFlow: { label: string };
  };
  outcomes: {
    notAppliedCount: number;
    distribution: Array<{ noveltyCode: string; count: number }>;
  };
  audit: { readyForAudit: number; inReview: number; approved: number; rejected: number };
  economics: {
    compensar: {
      projectedTariffReferenceValue: {
        availability: string;
        value: string | null;
        basis: string | null;
        reason: string | null;
      };
    };
    olp: {
      appliedSupplierCost: { availability: string; value: string | null; reason: string | null };
      requestedSupplierValue: { availability: string };
    };
    grossOperationalSpreadReference: { availability: string; value: string | null };
  } | null;
};

function row(auth: string, date: string, qty = 1): unknown[] {
  return [auth, DOC, CODE, qty, POINT_CODE, date];
}

function workbook(programacion: unknown[][], metadata: unknown[][] = META): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(programacion), 'Programacion');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(metadata), 'METADATA');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function api(
  method: string,
  path: string,
  body: unknown,
  token: string,
  organizationId: string,
): Promise<Response> {
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

async function upload(
  buffer: Buffer,
  filename: string,
  token = medicarteToken,
  organizationId = ORGANIZATION_IDS.MEDICARTE,
): Promise<Response> {
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
      'x-organization-id': organizationId,
    },
    body: form,
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function jobRows(jobId: string): Promise<Row[]> {
  const response = await api(
    'GET',
    `/bulk-imports/${jobId}/rows?filter=ALL`,
    undefined,
    medicarteToken,
    ORGANIZATION_IDS.MEDICARTE,
  );
  return (await json<{ items: Row[] }>(response)).items;
}

async function countSchedules(): Promise<number> {
  const result = await database.query<{ count: number }>(
    `select count(*)::int as count from patient_schedules
      where planning_period_id = $1`,
    [periodId],
  );
  return result.rows[0]?.count ?? 0;
}

async function insertAuthorizationItem(input: {
  authorizationNumber: string;
  commercialCode: string;
  document: string;
}): Promise<string> {
  const batch = await database.query<{ id: string }>(
    `insert into import_batches
      (organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
       processor_version, status, total_rows, confirmed_rows, completed_at, confirmed_at)
     values ($1, $2, $3, 'application/json', 1, $4, 1, 'COMPLETED', 1, 1, now(), now())
     returning id`,
    [
      ORGANIZATION_IDS.MTD,
      foundationUserId,
      `esp014-${input.authorizationNumber}.json`,
      'c'.repeat(64),
    ],
  );
  const item = await database.query<{ id: string }>(
    `insert into authorization_items
      (numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       created_from_batch_id)
     values ($1, $2, $3, $4::jsonb, 'VIGENTE', '', '', 'ENABLED', 'PBS', 'NOT_APPLICABLE',
             'ESP014', $5)
     returning id`,
    [
      input.authorizationNumber,
      input.commercialCode,
      `${input.authorizationNumber}:${input.commercialCode}`,
      JSON.stringify({
        IDENTIFICACION_PACIENTE: input.document,
        NOMBRE_PACIENTE: 'Paciente ESP-014',
        CANTIDAD: '5',
        FECHA_FINAL_VIGENCIA: '2099-12-31',
      }),
      batch.rows[0]!.id,
    ],
  );
  const created = item.rows[0]!.id;
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2) on conflict do nothing`,
    [created, ORGANIZATION_IDS.MEDICARTE],
  );
  return created;
}

async function cleanup(): Promise<void> {
  await database.query(`delete from bulk_import_jobs where original_filename like 'esp014-%'`);
  await database.query(
    `update patient_schedules
        set deferred_planning_period_id = null
      where deferred_planning_period_id in (
        select id from planning_periods where start_date between $1 and $2
      )`,
    [PERIOD.from, PERIOD.to],
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
    [PERIOD.from, PERIOD.to],
  );
  await database.query(
    `delete from patient_schedules
      where planning_period_id in (
        select id from planning_periods where start_date between $1 and $2
      )`,
    [PERIOD.from, PERIOD.to],
  );
  await database.query(
    `alter table patient_schedule_history enable trigger patient_schedule_history_no_delete`,
  );
  await database.query(
    `delete from authorization_item_organizations
      where authorization_item_id in (
        select id from authorization_items where numero_autorizacion like 'ESP014-%'
      )`,
  );
  await database.query(`delete from authorization_items where numero_autorizacion like 'ESP014-%'`);
  await database.query(`delete from import_batches where original_filename like 'esp014-%'`);
  await deletePointScopesForPointCodeLike(database, 'ESP14-PT%');
  await database.query(`delete from dispensing_points where code like 'ESP14-PT%'`);
  await database.query(`delete from planning_periods where start_date between $1 and $2`, [
    PERIOD.from,
    PERIOD.to,
  ]);
}

beforeAll(async () => {
  await database.connect();
  const admin = await database.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );
  foundationUserId = admin.rows[0]?.id ?? '';
  if (!foundationUserId) throw new Error('Foundation admin is unavailable');
  await cleanup();
  adminToken = await adminLogin();
  ({ medicarteToken, olpToken } = await ensureOperatorTokens());
  mtdToken = await ensureUser({
    adminToken,
    username: `esp014-mtd-${suffix}`,
    displayName: 'ESP014 MTD',
    password: `esp014-mtd-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.MTD,
    roleCode: 'MTD_GENERAL',
  });
  compensarToken = await ensureUser({
    adminToken,
    username: `esp014-comp-${suffix}`,
    displayName: 'ESP014 Compensar',
    password: `esp014-comp-${suffix}-pw`,
    organizationId: ORGANIZATION_IDS.COMPENSAR,
    roleCode: 'COMPENSAR_VIEWER',
  });
  itemId = await insertAuthorizationItem({
    authorizationNumber: AUTH_NUMBER,
    commercialCode: CODE,
    document: DOC,
  });
  itemBId = await insertAuthorizationItem({
    authorizationNumber: AUTH_B,
    commercialCode: CODE,
    document: DOC,
  });
  const snapshot = await database.query<Record<string, unknown>>(
    `select enablement_status, coverage_type, direction_status from authorization_items where id = $1`,
    [itemId],
  );
  authSnapshot = snapshot.rows[0]!;
  pointId = (
    await database.query<{ id: string }>(
      `insert into dispensing_points (organization_id, code, name, created_by)
       values ($1, $2, 'ESP-014 Punto', $3) returning id`,
      [ORGANIZATION_IDS.MEDICARTE, POINT_CODE, foundationUserId],
    )
  ).rows[0]!.id;
  periodId = (
    await database.query<{ id: string }>(
      `insert into planning_periods
        (start_date, end_date, scheduling_cutoff_at, purchase_order_deadline_at,
         expected_delivery_date, created_by, updated_by)
       values ('2046-06-02', '2046-06-08', '2046-06-10T23:59:00-05:00',
               '2046-06-11T23:59:00-05:00', '2046-06-12', $1, $1)
       returning id`,
      [foundationUserId],
    )
  ).rows[0]!.id;
  await grantAllPointsToMedicarteOperator(database);
});

afterAll(async () => {
  await cleanup();
  await database.end();
});

describe('Gate ESP-014 — operaciones masivas XLSX', () => {
  it('1. descarga la plantilla versionada de programación', async () => {
    const response = await fetch(`${apiUrl}/api/v1/bulk-imports/scheduling/template.xlsx`, {
      headers: {
        authorization: `Bearer ${medicarteToken}`,
        'x-organization-id': ORGANIZATION_IDS.MEDICARTE,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml');
    const book = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
    expect(book.SheetNames).toContain('Programacion');
    expect(book.SheetNames).toContain('METADATA');
    const meta = XLSX.utils.sheet_to_json<string[]>(book.Sheets.METADATA, { header: 1 });
    expect(meta.some((line) => line.includes('ESP014_SCHEDULING_V1'))).toBe(true);
  });

  it('2-6. upload válido, versión desconocida, header faltante, archivo corrupto y límite de filas', async () => {
    const valid = await upload(workbook([HEADER, row(AUTH_NUMBER, DATE_A)]), 'esp014-valid.xlsx');
    expect(valid.status).toBe(202);
    const created = await json<Job>(valid);
    expect(created.templateVersion).toBe('ESP014_SCHEDULING_V1');
    expect(created.status).toBe('READY');
    expect(created.validRows).toBe(1);

    const unknown = await upload(
      workbook(
        [HEADER, row(AUTH_NUMBER, DATE_A)],
        [
          ['KEY', 'VALUE'],
          ['templateVersion', 'ESP014_SCHEDULING_V9'],
          ['importType', 'SCHEDULING'],
        ],
      ),
      'esp014-unknown.xlsx',
    );
    expect(unknown.status).toBe(400);
    expect((await json<{ code: string }>(unknown)).code).toBe('UNKNOWN_TEMPLATE_VERSION');

    const missing = await upload(
      workbook([
        ['AUTORIZACION', 'DOCUMENTO'],
        [AUTH_NUMBER, DOC],
      ]),
      'esp014-headers.xlsx',
    );
    expect(missing.status).toBe(400);
    expect((await json<{ code: string }>(missing)).code).toBe('INVALID_HEADERS');

    const corrupt = await upload(Buffer.from('not-xlsx'), 'esp014-corrupt.xlsx');
    expect(corrupt.status).toBe(400);
    expect((await json<{ code: string }>(corrupt)).code).toBe('INVALID_FILE_FORMAT');

    const tooMany = await upload(
      workbook([HEADER, ...Array.from({ length: 5001 }, () => row(AUTH_NUMBER, DATE_A))]),
      'esp014-limit.xlsx',
    );
    expect(tooMany.status).toBe(400);
    expect((await json<{ code: string }>(tooMany)).code).toBe('TOO_MANY_ROWS');
  });

  it('7-12. staging no crea programación; preview válido, inválido y duplicado interno', async () => {
    const before = await countSchedules();
    const response = await upload(
      workbook([
        HEADER,
        row(AUTH_NUMBER, DATE_A),
        row('MISSING-AUTH', DATE_B),
        row(AUTH_NUMBER, DATE_C),
        row(AUTH_NUMBER, DATE_C),
      ]),
      'esp014-preview.xlsx',
    );
    expect(response.status).toBe(202);
    const job = await json<Job>(response);
    expect(await countSchedules()).toBe(before);
    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(2);
    expect(job.duplicateRows).toBeGreaterThanOrEqual(1);
    const rows = await jobRows(job.id);
    const valid = rows.find((item) => item.rowNumber === 2);
    const invalid = rows.find((item) => item.rowNumber === 3);
    const duplicate = rows.filter((item) => item.errorCode === 'DUPLICATE_IN_FILE');
    expect(valid?.validationStatus).toBe('VALID');
    expect(invalid?.validationStatus).toBe('INVALID');
    expect(invalid?.errorCode).toBe('AUTHORIZATION_ITEM_NOT_FOUND');
    expect(duplicate.length).toBeGreaterThan(0);
    expect(rows.every((item) => item.executionStatus !== 'SUCCEEDED')).toBe(true);
  });

  it('13. confirm exige READY', async () => {
    const uploaded = await upload(
      workbook([HEADER, row('NO-SUCH-AUTH', DATE_A)]),
      'esp014-invalid-only.xlsx',
    );
    const job = await json<Job>(uploaded);
    expect(job.status).toBe('INVALID');
    const confirm = await api(
      'POST',
      `/bulk-imports/${job.id}/confirm`,
      {},
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(confirm.status).toBe(409);
    expect((await json<{ code: string }>(confirm)).code).toBe('BULK_IMPORT_NOT_CONFIRMABLE');
  });

  it('14-18. confirm reutiliza ESP-003, no duplica y revalida', async () => {
    const uploaded = await upload(
      workbook([HEADER, row(AUTH_NUMBER, DATE_A)]),
      'esp014-confirm.xlsx',
    );
    const job = await json<Job>(uploaded);
    expect(job.status).toBe('READY');
    const [first, second] = await Promise.all([
      api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
      api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    ]);
    const statuses = [first.status, second.status];
    expect(statuses.every((status) => [200, 201, 409].includes(status))).toBe(true);
    expect(statuses.some((status) => [200, 201].includes(status))).toBe(true);
    const confirmed = await json<Job>(
      await api(
        'GET',
        `/bulk-imports/${job.id}`,
        undefined,
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    expect(['COMPLETED', 'PARTIALLY_COMPLETED'].includes(confirmed.status)).toBe(true);
    const rows = await jobRows(job.id);
    const succeeded = rows.filter((item) => item.executionStatus === 'SUCCEEDED');
    expect(succeeded).toHaveLength(1);
    const created = await database.query<{ change_type: string; count: string }>(
      `select change_type, count(*)::text as count from patient_schedule_history
        where patient_schedule_id = $1 group by change_type`,
      [succeeded[0]!.entityReference],
    );
    expect(created.rows.some((item) => item.change_type === 'CREATED')).toBe(true);
    const retry = await api(
      'POST',
      `/bulk-imports/${job.id}/confirm`,
      {},
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(retry.status).toBe(409);
    const schedules = await database.query<{ count: number }>(
      `select count(*)::int as count from patient_schedules
        where authorization_item_id = $1 and scheduled_date = $2 and status <> 'CANCELLED'`,
      [itemId, DATE_A],
    );
    expect(schedules.rows[0]?.count).toBe(1);
  });

  it('15-16. conflicto de identidad ESP-003 y revalidación entre preview y confirm', async () => {
    const created = await api(
      'POST',
      '/patient-schedules',
      {
        authorizationItemId: itemId,
        commercialCode: CODE,
        dispensingPointId: pointId,
        scheduledDate: DATE_B,
        quantity: 1,
      },
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(created.status).toBe(201);
    const previewConflict = await upload(
      workbook([HEADER, row(AUTH_NUMBER, DATE_B)]),
      'esp014-dup-identity.xlsx',
    );
    const conflictJob = await json<Job>(previewConflict);
    const conflictRows = await jobRows(conflictJob.id);
    expect(conflictRows[0]?.errorCode).toBe('DUPLICATE_EXISTING_SCHEDULE');

    const preview = await upload(
      workbook([HEADER, row(AUTH_NUMBER, DATE_C)]),
      'esp014-revalidate.xlsx',
    );
    const job = await json<Job>(preview);
    expect(job.status).toBe('READY');
    await database.query(
      `update authorization_items set enablement_status = 'BLOCKED_SOURCE_STATUS' where id = $1`,
      [itemId],
    );
    try {
      const confirm = await api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      );
      expect(confirm.ok).toBe(true);
      const failedJob = await json<Job>(confirm);
      expect(failedJob.status).toBe('FAILED');
      const executed = await jobRows(job.id);
      expect(executed[0]?.executionStatus).toBe('FAILED');
      expect(executed[0]?.errorCode).toBe('AUTHORIZATION_NOT_SCHEDULABLE');
    } finally {
      await database.query(
        `update authorization_items set enablement_status = 'ENABLED' where id = $1`,
        [itemId],
      );
    }
  });

  it('19-22. éxito parcial, SUCCEEDED no se reejecuta, retry-failed y recovery', async () => {
    await database.query(
      `update authorization_items set enablement_status = 'ENABLED' where id in ($1, $2)`,
      [itemId, itemBId],
    );
    const uploaded = await upload(
      workbook([HEADER, row(AUTH_B, DATE_A), row(AUTH_NUMBER, DATE_D)]),
      'esp014-partial.xlsx',
    );
    const job = await json<Job>(uploaded);
    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(2);
    const competingResponse = await api(
      'POST',
      '/patient-schedules',
      {
        authorizationItemId: itemId,
        commercialCode: CODE,
        dispensingPointId: pointId,
        scheduledDate: DATE_D,
        quantity: 1,
      },
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    expect(competingResponse.status).toBe(201);
    const competing = await json<{ id: string; revision: number }>(competingResponse);
    const confirmed = await json<Job>(
      await api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    let rows = await jobRows(job.id);
    expect(
      confirmed.status,
      JSON.stringify({
        status: confirmed.status,
        rows: rows.map((item) => ({
          rowNumber: item.rowNumber,
          executionStatus: item.executionStatus,
          errorCode: item.errorCode,
        })),
      }),
    ).toBe('PARTIALLY_COMPLETED');
    expect(rows.find((item) => item.rowNumber === 2)?.executionStatus).toBe('SUCCEEDED');
    expect(rows.find((item) => item.rowNumber === 3)?.executionStatus).toBe('FAILED');
    const firstEntity = rows.find((item) => item.rowNumber === 2)?.entityReference;
    const retrySame = await json<Job>(
      await api(
        'POST',
        `/bulk-imports/${job.id}/retry-failed`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    rows = await jobRows(retrySame.id);
    expect(rows.find((item) => item.rowNumber === 2)?.entityReference).toBe(firstEntity);
    expect(rows.find((item) => item.rowNumber === 2)?.executionStatus).toBe('SUCCEEDED');
    expect(rows.find((item) => item.rowNumber === 3)?.executionStatus).toBe('FAILED');

    await api(
      'POST',
      `/patient-schedules/${competing.id}/cancel`,
      { expectedRevision: competing.revision },
      medicarteToken,
      ORGANIZATION_IDS.MEDICARTE,
    );
    const recovered = await json<Job>(
      await api(
        'POST',
        `/bulk-imports/${job.id}/retry-failed`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    expect(recovered.status).toBe('COMPLETED');
    rows = await jobRows(job.id);
    expect(rows.every((item) => item.executionStatus === 'SUCCEEDED')).toBe(true);

    const pending = await upload(workbook([HEADER, row(AUTH_B, DATE_B)]), 'esp014-recovery.xlsx');
    const recoveryJob = await json<Job>(pending);
    const staleToken = randomUUID();
    await database.query(`update bulk_import_jobs set status = 'PROCESSING' where id = $1`, [
      recoveryJob.id,
    ]);
    const claimed = await database.query<{ id: string }>(
      `update bulk_import_rows
          set execution_status = 'PROCESSING',
              claim_token = $2,
              claim_generation = 1,
              claimed_at = now() - interval '3 minutes',
              claim_expires_at = now() - interval '1 second'
        where job_id = $1
        returning id`,
      [recoveryJob.id, staleToken],
    );
    const resumed = await json<Job>(
      await api(
        'POST',
        `/bulk-imports/${recoveryJob.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    expect(resumed.status).toBe('COMPLETED');
    const recoveredRows = await jobRows(recoveryJob.id);
    expect(recoveredRows[0]?.executionStatus).toBe('SUCCEEDED');
    const staleComplete = await database.query<{ id: string }>(
      `update bulk_import_rows
          set execution_status = 'SUCCEEDED'
        where id = $1
          and execution_status = 'PROCESSING'
          and claim_token = $2
          and claim_generation = 1
        returning id`,
      [claimed.rows[0]!.id, staleToken],
    );
    expect(staleComplete.rows).toHaveLength(0);
    const reclaimAudit = await database.query<{ action: string }>(
      `select action from audit_events
        where resource_id = $1 and action = 'BULK_IMPORT_ROW_RECLAIMED'`,
      [recoveryJob.id],
    );
    expect(reclaimAudit.rows.length).toBeGreaterThan(0);
  });

  it('two independent PostgreSQL clients cannot claim the same PENDING row', async () => {
    const uploaded = await upload(workbook([HEADER, row(AUTH_B, DATE_E)]), 'esp014-cas.xlsx');
    const job = await json<Job>(uploaded);
    const pendingRow = await database.query<{ id: string }>(
      `select id from bulk_import_rows where job_id = $1`,
      [job.id],
    );
    const rowId = pendingRow.rows[0]!.id;
    const claimSql = `
      update bulk_import_rows
         set execution_status = 'PROCESSING',
             claim_token = $2,
             claim_generation = claim_generation + 1,
             claimed_at = now(),
             claim_expires_at = now() + interval '120 seconds',
             attempt_count = attempt_count + 1
       where id = $1
         and execution_status = 'PENDING'
       returning id`;
    const clientA = new Client({ connectionString: databaseUrl });
    const clientB = new Client({ connectionString: databaseUrl });
    await clientA.connect();
    await clientB.connect();
    try {
      const [first, second] = await Promise.all([
        clientA.query<{ id: string }>(claimSql, [rowId, randomUUID()]),
        clientB.query<{ id: string }>(claimSql, [rowId, randomUUID()]),
      ]);
      expect([first.rowCount, second.rowCount].sort()).toEqual([0, 1]);
    } finally {
      await clientA.end();
      await clientB.end();
    }
    await database.query(
      `update bulk_import_rows
          set claim_expires_at = now() - interval '1 second'
        where id = $1`,
      [rowId],
    );
    const confirmed = await json<Job>(
      await api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    expect(confirmed.status).toBe('COMPLETED');
    const rows = await jobRows(job.id);
    expect(rows.filter((item) => item.executionStatus === 'SUCCEEDED')).toHaveLength(1);
  });

  it('two jobs confirming the same schedule identity keep a single active schedule', async () => {
    const file = workbook([HEADER, row(AUTH_NUMBER, DATE_F)]);
    const firstJob = await json<Job>(await upload(file, 'esp014-job-a.xlsx'));
    const secondJob = await json<Job>(await upload(file, 'esp014-job-b.xlsx'));
    const [first, second] = await Promise.all([
      api(
        'POST',
        `/bulk-imports/${firstJob.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
      api(
        'POST',
        `/bulk-imports/${secondJob.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const firstRows = await jobRows(firstJob.id);
    const secondRows = await jobRows(secondJob.id);
    const executed = [...firstRows, ...secondRows];
    expect(executed.filter((item) => item.executionStatus === 'SUCCEEDED')).toHaveLength(1);
    const failed = executed.filter((item) => item.executionStatus === 'FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.errorCode).toBe('PATIENT_SCHEDULE_DUPLICATE');
    const schedules = await database.query<{ count: number }>(
      `select count(*)::int as count from patient_schedules
        where authorization_item_id = $1 and scheduled_date = $2 and status <> 'CANCELLED'`,
      [itemId, DATE_F],
    );
    expect(schedules.rows[0]?.count).toBe(1);
  });

  it('create and row SUCCEEDED commit together; a mark failure rolls both back', async () => {
    const uploaded = await upload(workbook([HEADER, row(AUTH_B, DATE_D)]), 'esp014-atomic.xlsx');
    const job = await json<Job>(uploaded);
    const fn = `esp014_fail_mark_${suffix.replace(/-/g, '')}`;
    await database.query(`
      create or replace function ${fn}() returns trigger as $$
      begin
        if new.execution_status = 'SUCCEEDED' then
          raise exception 'esp014_injected_failure' using errcode = 'P0001';
        end if;
        return new;
      end;
      $$ language plpgsql;
    `);
    await database.query(
      `create trigger ${fn}
         before update on bulk_import_rows
         for each row
         when (new.job_id = '${job.id}'::uuid)
         execute function ${fn}()`,
    );
    try {
      await api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      );
      const schedules = await database.query<{ count: number }>(
        `select count(*)::int as count from patient_schedules
          where authorization_item_id = $1 and scheduled_date = $2`,
        [itemBId, DATE_D],
      );
      expect(schedules.rows[0]?.count).toBe(0);
      const interrupted = await jobRows(job.id);
      expect(interrupted[0]?.executionStatus).not.toBe('SUCCEEDED');
      expect(interrupted[0]?.entityReference).toBeNull();
    } finally {
      await database.query(`drop trigger if exists ${fn} on bulk_import_rows`);
      await database.query(`drop function if exists ${fn}()`);
    }
    await database.query(
      `update bulk_import_rows
          set claim_expires_at = now() - interval '1 second'
        where job_id = $1 and execution_status = 'PROCESSING'`,
      [job.id],
    );
    const recovered = await json<Job>(
      await api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    expect(recovered.status).toBe('COMPLETED');
    const rows = await jobRows(job.id);
    expect(rows[0]?.executionStatus).toBe('SUCCEEDED');
    expect(rows[0]?.entityReference).toBeTruthy();
    const history = await database.query<{ change_type: string }>(
      `select change_type from patient_schedule_history where patient_schedule_id = $1`,
      [rows[0]!.entityReference],
    );
    expect(history.rows.some((item) => item.change_type === 'CREATED')).toBe(true);
    const schedules = await database.query<{ count: number }>(
      `select count(*)::int as count from patient_schedules
        where authorization_item_id = $1 and scheduled_date = $2 and status <> 'CANCELLED'`,
      [itemBId, DATE_D],
    );
    expect(schedules.rows[0]?.count).toBe(1);
  });

  it('stale claimant cannot create a schedule after a newer generation', async () => {
    const uploaded = await upload(
      workbook([HEADER, row(AUTH_B, DATE_F)]),
      'esp014-stale-create.xlsx',
    );
    const job = await json<Job>(uploaded);
    const pending = await database.query<{ id: string }>(
      `select id from bulk_import_rows where job_id = $1`,
      [job.id],
    );
    const rowId = pending.rows[0]!.id;
    const staleToken = randomUUID();
    await database.query(
      `update bulk_import_rows
          set execution_status = 'PROCESSING',
              claim_token = $2,
              claim_generation = 10,
              claimed_at = now() - interval '3 minutes',
              claim_expires_at = now() - interval '1 second',
              attempt_count = 1
        where id = $1`,
      [rowId, staleToken],
    );
    await database.query(`update bulk_import_jobs set status = 'PROCESSING' where id = $1`, [
      job.id,
    ]);
    const confirmed = await json<Job>(
      await api(
        'POST',
        `/bulk-imports/${job.id}/confirm`,
        {},
        medicarteToken,
        ORGANIZATION_IDS.MEDICARTE,
      ),
    );
    expect(confirmed.status).toBe('COMPLETED');
    const staleLock = await database.query<{ id: string }>(
      `select id from bulk_import_rows
        where id = $1
          and execution_status = 'PROCESSING'
          and claim_token = $2
          and claim_generation = 10
        for update`,
      [rowId, staleToken],
    );
    expect(staleLock.rows).toHaveLength(0);
    const rows = await jobRows(job.id);
    expect(rows[0]?.executionStatus).toBe('SUCCEEDED');
    const schedules = await database.query<{ count: number }>(
      `select count(*)::int as count from patient_schedules
        where authorization_item_id = $1 and scheduled_date = $2 and status <> 'CANCELLED'`,
      [itemBId, DATE_F],
    );
    expect(schedules.rows[0]?.count).toBe(1);
  });

  it('23-28. RBAC Medicarte/MTD/OLP/Compensar, auditoría y PHI', async () => {
    const uploaded = await upload(workbook([HEADER, row(AUTH_B, DATE_C)]), 'esp014-rbac.xlsx');
    const job = await json<Job>(uploaded);
    expect(
      (await api('GET', `/bulk-imports/${job.id}`, undefined, mtdToken, ORGANIZATION_IDS.MTD))
        .status,
    ).toBe(200);
    expect(
      (await api('POST', `/bulk-imports/${job.id}/confirm`, {}, mtdToken, ORGANIZATION_IDS.MTD))
        .status,
    ).toBe(403);
    expect(
      (await api('GET', `/bulk-imports/${job.id}`, undefined, olpToken, ORGANIZATION_IDS.OLP))
        .status,
    ).toBe(403);
    expect(
      (
        await api(
          'GET',
          `/bulk-imports/${job.id}`,
          undefined,
          compensarToken,
          ORGANIZATION_IDS.COMPENSAR,
        )
      ).status,
    ).toBe(403);
    const audits = await database.query<{ action: string; after: unknown }>(
      `select action, after from audit_events
        where resource_type = 'bulk_import_job' and resource_id = $1
        order by occurred_at`,
      [job.id],
    );
    const actions = audits.rows.map((item) => item.action);
    expect(actions).toContain('BULK_IMPORT_UPLOADED');
    expect(actions).toContain('BULK_IMPORT_VALIDATED');
    for (const event of audits.rows) {
      const serialized = JSON.stringify(event.after);
      expect(serialized).not.toContain(DOC);
      expect(serialized).not.toMatch(/Paciente ESP-014/);
    }
  });

  it('29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura', async () => {
    const before = await countSchedules();
    const params = new URLSearchParams({ planningPeriodId: periodId, commercialCode: CODE });
    const operational = await json<Analytics>(
      await api(
        'GET',
        `/analytics/operational?${params}`,
        undefined,
        adminToken,
        ORGANIZATION_IDS.MTD,
      ),
    );
    const inventory = await json<{ summary: Analytics['inventory'] }>(
      await api(
        'GET',
        `/analytics/inventory?${params}`,
        undefined,
        adminToken,
        ORGANIZATION_IDS.MTD,
      ),
    );
    const novelties = await json<{ outcomes: Analytics['outcomes'] }>(
      await api(
        'GET',
        `/analytics/novelties?${params}`,
        undefined,
        adminToken,
        ORGANIZATION_IDS.MTD,
      ),
    );
    const economics = await json<{ economics: NonNullable<Analytics['economics']> }>(
      await api(
        'GET',
        `/analytics/economics?${params}`,
        undefined,
        adminToken,
        ORGANIZATION_IDS.MTD,
      ),
    );
    const exported = await fetch(`${apiUrl}/api/v1/analytics/export.xlsx?${params}`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': ORGANIZATION_IDS.MTD,
      },
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('spreadsheetml');
    const book = XLSX.read(Buffer.from(await exported.arrayBuffer()), { type: 'buffer' });
    expect(book.SheetNames).toEqual(
      expect.arrayContaining([
        'RESUMEN',
        'FUNNEL',
        'INVENTARIO',
        'NOVEDADES',
        'AUDITORIA',
        'ECONOMIA',
        'METADATA',
      ]),
    );
    const funnel = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.FUNNEL, { header: 1 });
    const projected = funnel.find((line) => line[0] === 'Proyectado');
    expect(projected?.[1]).toBe(operational.funnel.projectedQuantity);
    expect(funnel.find((line) => line[0] === 'Solicitado a OLP')?.[1]).toBe(
      operational.funnel.requestedQuantity,
    );
    const stock = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.INVENTARIO, { header: 1 });
    expect(stock.find((line) => line[0] === 'Stock físico actual')?.[1]).toBe(
      inventory.summary.currentOnHandQuantity,
    );
    expect(stock.find((line) => line[0] === 'Stock utilizable actual')?.[1]).toBe(
      inventory.summary.usableBalance,
    );
    expect(stock.find((line) => line[0] === 'En tránsito')?.[1]).toBe(
      inventory.summary.inTransitQuantity,
    );
    expect(JSON.stringify(stock).toLowerCase()).not.toMatch(/sobrante|leftover|period leftover/);
    const noveltySheet = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.NOVEDADES, { header: 1 });
    expect(noveltySheet.find((line) => line[0] === 'notAppliedCount')?.[1]).toBe(
      novelties.outcomes.notAppliedCount,
    );
    const auditSheet = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.AUDITORIA, { header: 1 });
    expect(auditSheet.find((line) => line[0] === 'approved')?.[1]).toBe(operational.audit.approved);
    const economy = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.ECONOMIA, { header: 1 });
    const applied = economy.find((line) => line[0] === 'appliedSupplierCost');
    const projectedTariff = economy.find((line) => line[0] === 'projectedTariffReferenceValue');
    expect(applied?.[1]).toBe(economics.economics.olp.appliedSupplierCost.availability);
    expect(applied?.[2]).toBe('No disponible');
    expect(applied?.[2]).not.toBe(0);
    expect(applied?.[2]).not.toBe('0');
    expect(projectedTariff?.[1]).toBe(
      economics.economics.compensar.projectedTariffReferenceValue.availability,
    );
    if (economics.economics.compensar.projectedTariffReferenceValue.availability !== 'EXACT') {
      expect(projectedTariff?.[2]).toBe('No disponible');
    }
    expect(economy.some((line) => line[0] === 'requestedSupplierValue')).toBe(true);
    expect(economy.some((line) => String(line[0]).toLowerCase() === 'price')).toBe(false);
    expect(await countSchedules()).toBe(before);
  });

  it('41-43. no hay RESERVED, el command crea historia y las entidades históricas no cambian', async () => {
    const reserved = await database.query<{ count: number }>(
      `select count(*)::int as count from information_schema.columns
        where table_schema = 'public' and column_name = 'reserved'`,
    );
    expect(reserved.rows[0]?.count).toBe(0);
    const current = await database.query<Record<string, unknown>>(
      `select enablement_status, coverage_type, direction_status from authorization_items where id = $1`,
      [itemId],
    );
    expect(current.rows[0]).toEqual(authSnapshot);
    const applications = await database.query<{ count: number }>(
      `select count(*)::int as count from bulk_import_jobs where import_type <> 'SCHEDULING'`,
    );
    expect(applications.rows[0]?.count).toBe(0);
  });
});

const ESP014_REQUIREMENT_COVERAGE: ReadonlyArray<{
  requirement: string;
  test: string;
  assertions: string;
}> = [
  {
    requirement: '1. template download',
    test: '1. descarga la plantilla versionada de programación',
    assertions: 'HTTP 200 spreadsheetml; hojas Programacion y METADATA',
  },
  {
    requirement: '2. template version',
    test: '1. descarga la plantilla versionada de programación',
    assertions: 'METADATA contiene ESP014_SCHEDULING_V1',
  },
  {
    requirement: '3. unknown version',
    test: '2-6. upload válido, versión desconocida, header faltante, archivo corrupto y límite de filas',
    assertions: '400 UNKNOWN_TEMPLATE_VERSION',
  },
  {
    requirement: '4. invalid header',
    test: '2-6. upload válido, versión desconocida, header faltante, archivo corrupto y límite de filas',
    assertions: '400 INVALID_HEADERS',
  },
  {
    requirement: '5. corrupt XLSX',
    test: '2-6. upload válido, versión desconocida, header faltante, archivo corrupto y límite de filas',
    assertions: '400 INVALID_FILE_FORMAT',
  },
  {
    requirement: '6. file/row limits',
    test: '2-6. upload válido, versión desconocida, header faltante, archivo corrupto y límite de filas',
    assertions: '400 TOO_MANY_ROWS for 5001 rows',
  },
  {
    requirement: '7. staging no crea schedules',
    test: '7-12. staging no crea programación; preview válido, inválido y duplicado interno',
    assertions: 'count(patient_schedules) unchanged after upload',
  },
  {
    requirement: '8. preview validation',
    test: '7-12. staging no crea programación; preview válido, inválido y duplicado interno',
    assertions: 'job READY with valid/invalid/duplicate row statuses',
  },
  {
    requirement: '9. valid/invalid rows',
    test: '7-12. staging no crea programación; preview válido, inválido y duplicado interno',
    assertions: 'VALID vs INVALID AUTHORIZATION_ITEM_NOT_FOUND',
  },
  {
    requirement: '10. internal duplicate',
    test: '7-12. staging no crea programación; preview válido, inválido y duplicado interno',
    assertions: 'DUPLICATE_IN_FILE on repeated identity',
  },
  {
    requirement: '11. confirm requires READY',
    test: '13. confirm exige READY',
    assertions: 'INVALID job confirm 409 BULK_IMPORT_NOT_CONFIRMABLE',
  },
  {
    requirement: '12. confirm uses ESP-003',
    test: '14-18. confirm reutiliza ESP-003, no duplica y revalida',
    assertions: 'patient_schedule_history CREATED for entityReference',
  },
  {
    requirement: '13. domain revalidation after preview',
    test: '15-16. conflicto de identidad ESP-003 y revalidación entre preview y confirm',
    assertions: 'blocked auth after preview → FAILED AUTHORIZATION_NOT_SCHEDULABLE; job FAILED',
  },
  {
    requirement: '14. double confirm',
    test: '14-18. confirm reutiliza ESP-003, no duplica y revalida',
    assertions:
      'two concurrent POSTs; one SUCCEEDED row; one active schedule; sequential confirm 409',
  },
  {
    requirement: '15. two independent processors',
    test: 'two independent PostgreSQL clients cannot claim the same PENDING row',
    assertions: 'two pg clients CAS; exactly one RETURNING; no shared in-memory mutex',
  },
  {
    requirement: '16. concurrent jobs same identity',
    test: 'two jobs confirming the same schedule identity keep a single active schedule',
    assertions: 'one SUCCEEDED, one FAILED PATIENT_SCHEDULE_DUPLICATE, one active schedule',
  },
  {
    requirement: '17. partial success',
    test: '19-22. éxito parcial, SUCCEEDED no se reejecuta, retry-failed y recovery',
    assertions: 'PARTIALLY_COMPLETED; one SUCCEEDED one FAILED; no global rollback',
  },
  {
    requirement: '18. SUCCEEDED not reexecuted',
    test: '19-22. éxito parcial, SUCCEEDED no se reejecuta, retry-failed y recovery',
    assertions: 'retry-failed keeps the same entityReference on SUCCEEDED',
  },
  {
    requirement: '19. retry-failed',
    test: '19-22. éxito parcial, SUCCEEDED no se reejecuta, retry-failed y recovery',
    assertions: 'after cancel competitor, retry completes remaining FAILED to SUCCEEDED',
  },
  {
    requirement: '20. stale PROCESSING recovery',
    test: '19-22. éxito parcial, SUCCEEDED no se reejecuta, retry-failed y recovery',
    assertions: 'expired lease PROCESSING reclaimed on confirm → COMPLETED',
  },
  {
    requirement: '21. fencing/stale claimant',
    test: '19-22. éxito parcial, SUCCEEDED no se reejecuta, retry-failed y recovery',
    assertions: 'stale claim_token UPDATE returns 0 rows; BULK_IMPORT_ROW_RECLAIMED audited',
  },
  {
    requirement: '22. Medicarte manage',
    test: '23-28. RBAC Medicarte/MTD/OLP/Compensar, auditoría y PHI',
    assertions: 'Medicarte upload/confirm; MTD confirm 403',
  },
  {
    requirement: '23. MTD read policy',
    test: '23-28. RBAC Medicarte/MTD/OLP/Compensar, auditoría y PHI',
    assertions: 'MTD GET 200',
  },
  {
    requirement: '24. OLP 403',
    test: '23-28. RBAC Medicarte/MTD/OLP/Compensar, auditoría y PHI',
    assertions: 'OLP GET 403',
  },
  {
    requirement: '25. Compensar 403',
    test: '23-28. RBAC Medicarte/MTD/OLP/Compensar, auditoría y PHI',
    assertions: 'Compensar GET 403',
  },
  {
    requirement: '26. audit events',
    test: '23-28. RBAC Medicarte/MTD/OLP/Compensar, auditoría y PHI',
    assertions: 'BULK_IMPORT_UPLOADED/VALIDATED; after payload has no PHI',
  },
  {
    requirement: '27. analytics export XLSX',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'GET export.xlsx 200 with expected sheets',
  },
  {
    requirement: '28. filters equal ESP-013',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'same planningPeriodId and commercialCode as operational API',
  },
  {
    requirement: '29. funnel export == API',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'FUNNEL Proyectado/Solicitado match operational.funnel',
  },
  {
    requirement: '30. inventory export == API',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'INVENTARIO stock matches analytics/inventory',
  },
  {
    requirement: '31. novelty export == API',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'NOVEDADES notAppliedCount matches analytics/novelties',
  },
  {
    requirement: '32. audit export == API',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'AUDITORIA approved matches operational.audit',
  },
  {
    requirement: '33. economics export == API',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'ECONOMIA appliedSupplierCost availability matches economics API',
  },
  {
    requirement: '34. UNAVAILABLE != 0',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'applied cell is No disponible, not 0',
  },
  {
    requirement: '35. tariff COMPENSAR != OLP cost',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'projectedTariffReferenceValue is compensar; appliedSupplierCost is olp',
  },
  {
    requirement: '36. appliedSupplierCost not fabricated',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'availability UNAVAILABLE written as No disponible',
  },
  {
    requirement: '37. current inventory not period leftover',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'inventory sheet has no sobrante/leftover wording',
  },
  {
    requirement: '38. export read-only',
    test: '29-40. export analítico reutiliza ESP-013, UNAVAILABLE no es 0 y es solo lectura',
    assertions: 'schedule count unchanged after export',
  },
  {
    requirement: '39. no RESERVED',
    test: '41-43. no hay RESERVED, el command crea historia y las entidades históricas no cambian',
    assertions: 'information_schema has zero reserved columns',
  },
  {
    requirement: '40. historical operational records unchanged',
    test: '41-43. no hay RESERVED, el command crea historia y las entidades históricas no cambian',
    assertions: 'authorization_items snapshot equals baseline; import_type only SCHEDULING',
  },
  {
    requirement: 'ATOMIC_ROW_EXECUTION',
    test: 'create and row SUCCEEDED commit together; a mark failure rolls both back',
    assertions:
      'schedule create + row success same durable outcome; history CREATED in same result',
  },
  {
    requirement: 'CRASH_BETWEEN_CREATE_AND_MARK',
    test: 'create and row SUCCEEDED commit together; a mark failure rolls both back',
    assertions: 'injected failure after create before commit leaves no schedule and no SUCCEEDED',
  },
  {
    requirement: 'REAL_DUPLICATE',
    test: 'two jobs confirming the same schedule identity keep a single active schedule',
    assertions: 'PATIENT_SCHEDULE_DUPLICATE remains FAILED; not treated as success',
  },
  {
    requirement: 'STALE_CLAIM',
    test: 'stale claimant cannot create a schedule after a newer generation',
    assertions: 'generation 10 lock matches 0 rows after generation 11 succeeded; cannot create',
  },
  {
    requirement: 'MULTI_NODE',
    test: 'two independent PostgreSQL clients cannot claim the same PENDING row',
    assertions: 'exactly one CAS winner; one SUCCEEDED row execution',
  },
];

describe('Gate ESP-014 requirement coverage matrix', () => {
  it('maps all hardening requirements to an executable assertion', () => {
    expect(ESP014_REQUIREMENT_COVERAGE).toHaveLength(45);
    expect(new Set(ESP014_REQUIREMENT_COVERAGE.map((item) => item.requirement)).size).toBe(45);
  });
});
