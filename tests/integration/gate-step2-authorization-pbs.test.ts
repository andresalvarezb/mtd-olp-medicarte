import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin } from './helpers/auth';

const ESP014_AUTHORIZATIONS_TEMPLATE_VERSION = 'ESP014_AUTHORIZATIONS_V1';

const AUTHORIZATION_IMPORT_COLUMNS = [
  'CODEPS',
  'NUMERO_AUTORIZACION',
  'TIPO_IDENTIFICACION',
  'IDENTIFICACION_PACIENTE',
  'NOMBRE_PACIENTE',
  'NUMERO_TELEFONO',
  'CPRG',
  'CDGN001',
  'COD_CUPS_PRINCIPAL',
  'CUPS_PRINCIPAL',
  'CODIGO_COMERCIAL',
  'CUMS',
  'NIT_PRESTADOR',
  'NOMBRE_PRESTADOR',
  'COD_CUPS_AUTORIZADO',
  'CUPS_AUTORIZADO',
  'CANTIDAD',
  'DOSIS',
  'FECHA_ASIGNACION',
  'FECHA_FINAL_VIGENCIA',
  'ESTADO_AUTORIZACION',
  'OBS_AUTORIZACION',
  'MEDICO_REMITENTE',
  'CMNT',
  'IDENTIFICADOR_FUENTE',
  'FPRO',
  'VALOR_CUOTA_MODERADORA',
  'NUMERO_PRESCRIPCION',
] as const;

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const apiUrl = process.env.API_URL ?? 'http://localhost:3004';
const database = new Client({ connectionString: databaseUrl });

const suffix = randomUUID().slice(0, 8).toUpperCase();

const CODE_PBS = `M2A-PBS-${suffix}`;
const CODE_NO_PBS = `M2A-NOPBS-${suffix}`;
const CODE_INVALID = `M2A-INV-${suffix}`;
const CODE_TOCTOU = `M2A-TOC-${suffix}`;
const CODE_EXP_TODAY = `M2A-EXP-TODAY-${suffix}`;
const CODE_EXP_FUTURE = `M2A-EXP-FUT-${suffix}`;
const CODE_EXP_EXPIRED = `M2A-EXP-OLD-${suffix}`;
const CODE_EXP_MISSING = `M2A-EXP-MISS-${suffix}`;

const AUTH_PBS = `M2A-AUTH-PBS-${suffix}`;
const AUTH_NO_PBS = `M2A-AUTH-NOPBS-${suffix}`;
const AUTH_INVALID = `M2A-AUTH-INV-${suffix}`;
const AUTH_TOCTOU = `M2A-AUTH-TOC-${suffix}`;
const AUTH_EXP_TODAY = `M2A-AUTH-EXP-TODAY-${suffix}`;
const AUTH_EXP_FUTURE = `M2A-AUTH-EXP-FUT-${suffix}`;
const AUTH_EXP_EXPIRED = `M2A-AUTH-EXP-OLD-${suffix}`;
const AUTH_EXP_MISSING = `M2A-AUTH-EXP-MISS-${suffix}`;

let adminToken = '';
let foundationUserId = '';

type Job = {
  id: string;
  importType: 'AUTHORIZATIONS' | 'SCHEDULING';
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
  errorMessage: string | null;
  entityReference: string | null;
};

function bogotaDateForGate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function buildAuthorizationWorkbook(input: {
  authorizationNumber: string;
  commercialCode: string;
  assignmentDate?: string;
  expirationDate?: string;
  sourceStatus?: string;
}): Buffer {
  const workbook = XLSX.utils.book_new();

  const values: Record<string, unknown> = {
    CODEPS: 'EPS001',
    NUMERO_AUTORIZACION: input.authorizationNumber,
    TIPO_IDENTIFICACION: 'CC',
    IDENTIFICACION_PACIENTE: `DOC-${suffix}`,
    NOMBRE_PACIENTE: 'Paciente Macro 2A',
    NUMERO_TELEFONO: '3000000000',
    CPRG: 'CPRG',
    CDGN001: 'CDGN001',
    COD_CUPS_PRINCIPAL: 'CUPS001',
    CUPS_PRINCIPAL: 'CUPS PRINCIPAL',
    CODIGO_COMERCIAL: input.commercialCode,
    CUMS: 'CUMS001',
    NIT_PRESTADOR: '900000000',
    NOMBRE_PRESTADOR: 'PRESTADOR TEST',
    COD_CUPS_AUTORIZADO: 'CUPSA001',
    CUPS_AUTORIZADO: 'CUPS AUTORIZADO',
    CANTIDAD: 2,
    DOSIS: '1',
    FECHA_ASIGNACION: input.assignmentDate ?? `${bogotaDateForGate().slice(0, 7)}-01`,
    FECHA_FINAL_VIGENCIA: input.expirationDate ?? '2099-12-31',
    ESTADO_AUTORIZACION: input.sourceStatus ?? '5',
    OBS_AUTORIZACION: '',
    MEDICO_REMITENTE: 'MEDICO TEST',
    CMNT: '',
    IDENTIFICADOR_FUENTE: `SRC-${suffix}`,
    FPRO: '',
    VALOR_CUOTA_MODERADORA: '0',
    NUMERO_PRESCRIPCION: '',
  };

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [...AUTHORIZATION_IMPORT_COLUMNS],
      AUTHORIZATION_IMPORT_COLUMNS.map((column) => values[column] ?? ''),
    ]),
    'Autorizaciones',
  );

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['KEY', 'VALUE'],
      ['templateVersion', ESP014_AUTHORIZATIONS_TEMPLATE_VERSION],
      ['importType', 'AUTHORIZATIONS'],
    ]),
    'METADATA',
  );

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

async function uploadAuthorization(input: {
  authorizationNumber: string;
  commercialCode: string;
  filename: string;
  assignmentDate?: string;
  expirationDate?: string;
  sourceStatus?: string;
}): Promise<Response> {
  const form = new FormData();

  const buffer = buildAuthorizationWorkbook({
    authorizationNumber: input.authorizationNumber,
    commercialCode: input.commercialCode,
    assignmentDate: input.assignmentDate,
    expirationDate: input.expirationDate,
    sourceStatus: input.sourceStatus,
  });

  form.append(
    'file',
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    input.filename,
  );

  return fetch(`${apiUrl}/api/v1/bulk-imports/authorizations/upload`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    body: form,
  });
}

async function confirm(jobId: string): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/bulk-imports/${jobId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
    body: JSON.stringify({}),
  });
}

async function rows(jobId: string): Promise<Row[]> {
  const response = await fetch(`${apiUrl}/api/v1/bulk-imports/${jobId}/rows?filter=ALL`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': ORGANIZATION_IDS.MTD,
    },
  });

  expect(response.status).toBe(200);

  const payload = (await response.json()) as { items: Row[] };
  return payload.items;
}

async function authorizationCount(authorizationNumber: string): Promise<number> {
  const result = await database.query<{ n: number }>(
    `select count(*)::int n
       from authorization_items
      where numero_autorizacion = $1`,
    [authorizationNumber],
  );

  return result.rows[0]?.n ?? 0;
}

async function seedTariffProduct(input: {
  code: string;
  tipoInclusion: string | null;
}): Promise<void> {
  await database.query(
    `insert into tariff_annex_products (
       codigo_producto,
       tarifa_unidad,
       tarifa_unidad_canonical,
       descripcion_generica,
       descripcion_comercial,
       laboratorio,
       tipo_inclusion,
       active,
       organization_id,
       created_by,
       updated_by,
       version
     )
     values (
       $1,
       '1000',
       1000,
       'PRODUCTO TEST',
       'PRODUCTO TEST',
       'LAB TEST',
       $2,
       true,
       $3,
       $4,
       $4,
       1
     )`,
    [input.code, input.tipoInclusion, ORGANIZATION_IDS.MTD, foundationUserId],
  );
}

async function cleanup(): Promise<void> {
  await database.query(
    `delete from authorization_item_organizations
      where authorization_item_id in (
        select id
          from authorization_items
         where numero_autorizacion like $1
      )`,
    ['M2A-AUTH-%'],
  );

  await database.query(
    `delete from authorization_items
      where numero_autorizacion like $1`,
    ['M2A-AUTH-%'],
  );

  await database.query(
    `delete from bulk_import_jobs
      where original_filename like $1`,
    ['m2a-%'],
  );

  await database.query(
    `delete from import_batches
      where original_filename like $1`,
    ['m2a-%'],
  );

  await database.query(
    `delete from tariff_annex_products
      where codigo_producto like $1`,
    ['M2A-%'],
  );
}

beforeAll(async () => {
  await database.connect();

  const admin = await database.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );

  foundationUserId = admin.rows[0]?.id ?? '';

  if (!foundationUserId) {
    throw new Error('Foundation admin is unavailable');
  }

  await cleanup();

  adminToken = await adminLogin();

  await seedTariffProduct({
    code: CODE_PBS,
    tipoInclusion: ' pbs ',
  });

  await seedTariffProduct({
    code: CODE_NO_PBS,
    tipoInclusion: ' no pbs ',
  });

  await seedTariffProduct({
    code: CODE_INVALID,
    tipoInclusion: null,
  });

  await seedTariffProduct({
    code: CODE_TOCTOU,
    tipoInclusion: 'PBS',
  });

  await seedTariffProduct({
    code: CODE_EXP_TODAY,
    tipoInclusion: 'PBS',
  });

  await seedTariffProduct({
    code: CODE_EXP_FUTURE,
    tipoInclusion: 'PBS',
  });

  await seedTariffProduct({
    code: CODE_EXP_EXPIRED,
    tipoInclusion: 'PBS',
  });

  await seedTariffProduct({
    code: CODE_EXP_MISSING,
    tipoInclusion: 'PBS',
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await database.end();
  }
});

describe('Macro 2 / 2A + 2B — elegibilidad AT + PBS + vigencia', () => {
  it('1. PBS activo materializa autorización derivando coverage_type desde AT', async () => {
    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_PBS,
      commercialCode: CODE_PBS,
      filename: `m2a-pbs-${suffix}.xlsx`,
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    const item = await database.query<{
      source_status_normalized: string;
      enablement_status: string;
      coverage_type: string;
      direction_status: string;
      coverage_rule_version: string;
      source_data: Record<string, unknown>;
    }>(
      `select
         source_status_normalized,
         enablement_status,
         coverage_type,
         direction_status,
         coverage_rule_version,
         source_data
       from authorization_items
       where numero_autorizacion = $1
         and codigo_medicamento = $2`,
      [AUTH_PBS, CODE_PBS],
    );

    expect(item.rows).toHaveLength(1);
    expect(item.rows[0]?.source_status_normalized).toBe('5');
    expect(item.rows[0]?.enablement_status).toBe('ENABLED');
    expect(item.rows[0]?.coverage_type).toBe('PBS');
    expect(item.rows[0]?.direction_status).toBe('NOT_APPLICABLE');
    expect(item.rows[0]?.coverage_rule_version).toBe('AUTHORIZATIONS_V1');

    expect(item.rows[0]?.source_data).not.toHaveProperty('coverageType');

    const executedRows = await rows(job.id);

    expect(executedRows).toHaveLength(1);
    expect(executedRows[0]?.executionStatus).toBe('SUCCEEDED');
    expect(executedRows[0]?.entityReference).toBeTruthy();
  });

  it('2. NO_PBS activo se persiste y queda pendiente de direccionamiento', async () => {
    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_NO_PBS,
      commercialCode: CODE_NO_PBS,
      filename: `m2a-no-pbs-${suffix}.xlsx`,
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    const executedRows = await rows(job.id);

    expect(executedRows).toHaveLength(1);
    expect(executedRows[0]?.validationStatus).toBe('VALID');
    expect(executedRows[0]?.executionStatus).toBe('SUCCEEDED');
    expect(executedRows[0]?.errorCode).toBeNull();
    expect(executedRows[0]?.entityReference).toBeTruthy();

    const item = await database.query<{
      coverage_type: string;
      direction_status: string;
      tariff_membership_status: string;
    }>(
      `select
         coverage_type,
         direction_status,
         tariff_membership_status
       from authorization_items
       where numero_autorizacion = $1
         and codigo_medicamento = $2`,
      [AUTH_NO_PBS, CODE_NO_PBS],
    );

    expect(item.rows).toHaveLength(1);

    expect(item.rows[0]).toMatchObject({
      coverage_type: 'NO_PBS',
      direction_status: 'PENDING',
      tariff_membership_status: 'LISTED',
    });
  });

  it('3. clasificación AT ausente se persiste como UNCLASSIFIED', async () => {
    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_INVALID,
      commercialCode: CODE_INVALID,
      filename: `m2a-invalid-${suffix}.xlsx`,
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    const executedRows = await rows(job.id);

    expect(executedRows).toHaveLength(1);
    expect(executedRows[0]?.executionStatus).toBe('SUCCEEDED');
    expect(executedRows[0]?.errorCode).toBeNull();

    const item = await database.query<{
      coverage_type: string;
      direction_status: string;
      tariff_membership_status: string;
    }>(
      `select
         coverage_type,
         direction_status,
         tariff_membership_status
       from authorization_items
       where numero_autorizacion = $1
         and codigo_medicamento = $2`,
      [AUTH_INVALID, CODE_INVALID],
    );

    expect(item.rows).toHaveLength(1);

    expect(item.rows[0]).toMatchObject({
      coverage_type: 'UNCLASSIFIED',
      direction_status: 'PENDING',
      tariff_membership_status: 'LISTED',
    });
  });

  it('4. revalida AT al confirmar y materializa la clasificación vigente PBS→NO_PBS', async () => {
    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_TOCTOU,
      commercialCode: CODE_TOCTOU,
      filename: `m2a-toctou-${suffix}.xlsx`,
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    await database.query(
      `update tariff_annex_products
          set tipo_inclusion = 'NO PBS',
              version = version + 1,
              updated_by = $2,
              updated_at = now()
        where codigo_producto = $1
          and organization_id = $3`,
      [
        CODE_TOCTOU,
        foundationUserId,
        ORGANIZATION_IDS.MTD,
      ],
    );

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    const executedRows = await rows(job.id);

    expect(executedRows).toHaveLength(1);
    expect(executedRows[0]?.executionStatus).toBe('SUCCEEDED');
    expect(executedRows[0]?.errorCode).toBeNull();
    expect(executedRows[0]?.entityReference).toBeTruthy();

    const item = await database.query<{
      coverage_type: string;
      direction_status: string;
      tariff_membership_status: string;
      tariff_rule_version: string;
    }>(
      `select
         coverage_type,
         direction_status,
         tariff_membership_status,
         tariff_rule_version
       from authorization_items
       where numero_autorizacion = $1
         and codigo_medicamento = $2`,
      [AUTH_TOCTOU, CODE_TOCTOU],
    );

    expect(item.rows).toHaveLength(1);

    expect(item.rows[0]).toMatchObject({
      coverage_type: 'NO_PBS',
      direction_status: 'PENDING',
      tariff_membership_status: 'LISTED',
      tariff_rule_version: 'TARIFF-ANNEX-1:2',
    });
  });

  it('5. vigencia igual a hoy America/Bogota es válida y materializa', async () => {
    const todayBogota = bogotaDateForGate();

    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_EXP_TODAY,
      commercialCode: CODE_EXP_TODAY,
      filename: `m2a-exp-today-${suffix}.xlsx`,
      expirationDate: todayBogota,
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    expect(await authorizationCount(AUTH_EXP_TODAY)).toBe(1);
  });

  it('6. vigencia futura es válida y materializa', async () => {
    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_EXP_FUTURE,
      commercialCode: CODE_EXP_FUTURE,
      filename: `m2a-exp-future-${suffix}.xlsx`,
      expirationDate: '2099-12-31',
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    expect(await authorizationCount(AUTH_EXP_FUTURE)).toBe(1);
  });

  it('7. vigencia anterior a hoy se persiste para evaluación de vigencia', async () => {
    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_EXP_EXPIRED,
      commercialCode: CODE_EXP_EXPIRED,
      filename: `m2a-exp-expired-${suffix}.xlsx`,
      expirationDate: '2000-01-01',
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    expect(
      await authorizationCount(
        AUTH_EXP_EXPIRED,
      ),
    ).toBe(1);

    const item = await database.query<{
      source_data: Record<string, unknown>;
    }>(
      `select source_data
       from authorization_items
       where numero_autorizacion = $1
         and codigo_medicamento = $2`,
      [
        AUTH_EXP_EXPIRED,
        CODE_EXP_EXPIRED,
      ],
    );

    expect(
      item.rows[0]?.source_data
        .FECHA_FINAL_VIGENCIA,
    ).toBe('2000-01-01');
  });

  it('8. FECHA_FINAL_VIGENCIA ausente se persiste para evaluación posterior', async () => {
    const uploaded = await uploadAuthorization({
      authorizationNumber: AUTH_EXP_MISSING,
      commercialCode: CODE_EXP_MISSING,
      filename: `m2a-exp-missing-${suffix}.xlsx`,
      expirationDate: '',
    });

    expect(uploaded.status).toBe(202);

    const job = (await uploaded.json()) as Job;

    expect(job.status).toBe('READY');
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(0);

    const confirmedResponse = await confirm(job.id);

    expect(confirmedResponse.status).toBe(200);

    const confirmed = (await confirmedResponse.json()) as Job;

    expect(confirmed.succeededRows).toBe(1);
    expect(confirmed.failedRows).toBe(0);

    expect(
      await authorizationCount(
        AUTH_EXP_MISSING,
      ),
    ).toBe(1);

    const item = await database.query<{
      source_data: Record<string, unknown>;
    }>(
      `select source_data
       from authorization_items
       where numero_autorizacion = $1
         and codigo_medicamento = $2`,
      [
        AUTH_EXP_MISSING,
        CODE_EXP_MISSING,
      ],
    );

    expect(
      item.rows[0]?.source_data
        .FECHA_FINAL_VIGENCIA,
    ).toBe('');
  });

});
