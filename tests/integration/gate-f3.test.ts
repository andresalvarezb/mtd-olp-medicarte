import { randomUUID } from 'node:crypto';
import { loginDev } from './helpers/auth';
import { registerTariffProducts } from './helpers/tariff';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mipresRecheckRequestResponseSchema } from '../../packages/contracts/src/index.js';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';

const sourceColumns = [
  'CODEPS',
  'NUMERO_AUTORIZACION',
  'TIP_DOCUMENTO',
  'NUM_DOCUMENTO',
  'NOMBRE_PACIENTE',
  'NUMERO_TELEFONO',
  'COD_CUPS_PRINCIPAL',
  'CUPS_PRINCIPAL',
  'COD_COMERCIAL',
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
  'No.PRESCRIPCION',
  'OBS_AUTORIZACION',
  'MEDICO_REMITENTE',
  'CMNT',
  '_Id',
  'FPRO',
  'VALOR CUOTA MODERADORA',
];

const database = new Client({ connectionString: databaseUrl });
let adminToken: string;
let olpToken: string;

function csvValue(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: string[]): string {
  return values.map(csvValue).join(',');
}

function authorizationCsv(
  rows: Array<{ authorization: string; medication: string; prescripcion: string; status: string }>,
): string {
  return [
    csvRow(sourceColumns),
    ...rows.map((row) =>
      csvRow([
        'EPS-1',
        row.authorization,
        'CC',
        '123',
        'Paciente de prueba F3',
        '3000000000',
        'CUPS-1',
        'MEDICAMENTOS POS',
        row.medication,
        'CUM-1',
        '900000001',
        'Prestador de prueba',
        'CUPS-2',
        'Medicamento autorizado',
        '1',
        '1',
        '2026-08-01',
        '2026-12-31',
        row.status,
        row.prescripcion,
        'prueba F3',
        'Medico de prueba',
        'comentario',
        'source-1',
        'FPRO-1',
        '0',
      ]),
    ),
    '',
  ].join('\n');
}

async function login(username: string, password: string): Promise<string> {
  return loginDev(username, password); // ADR-026
}

async function createImport(token: string, content: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), 'authorizations.csv');
  const response = await fetch(`${apiUrl}/api/v1/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  if (response.status !== 202)
    throw new Error(`Import creation failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { id: string };
}

async function waitForBatch(
  token: string,
  batchId: string,
): Promise<{ status: string; validRows: number; rejectedRows: number }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': mtdOrganizationId },
    });
    if (response.ok) {
      const batch = (await response.json()) as {
        status: string;
        validRows: number;
        rejectedRows: number;
      };
      if (batch.status === 'READY_TO_CONFIRM' || batch.status === 'COMPLETED') return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Import batch never became ready');
}

async function confirmImport(token: string, batchId: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (response.status !== 200)
    throw new Error(`Import confirmation failed: ${response.status} ${await response.text()}`);
}

async function importNoPbsItem(suffix: string): Promise<{ itemId: string; prescription: string }> {
  const authorization = `AUTH-F3-${randomUUID()}`;
  const prescription = `2026091512345678${suffix}000`;
  const medication = `MED-F3-${suffix}`.toUpperCase();
  await registerTariffProducts(adminToken, [medication]);
  const batch = await createImport(
    adminToken,
    authorizationCsv([
      { authorization, medication, prescripcion: prescription, status: '5' },
    ]),
  );
  await waitForBatch(adminToken, batch.id);
  await confirmImport(adminToken, batch.id);
  const items = await database.query<{ id: string; direction_status: string | null }>(
    'select id, direction_status from authorization_items where numero_autorizacion = $1',
    [authorization.toUpperCase()],
  );
  const item = items.rows[0];
  if (!item) throw new Error('Expected NO_PBS item to be confirmed');
  expect(item.direction_status).toBe('PENDING');
  return { itemId: item.id, prescription };
}

async function requestRecheck(
  itemId: string,
  options: {
    token?: string;
    organizationId?: string;
    idempotencyKey?: string;
  } = {},
): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/authorization-items/${itemId}/mipres-rechecks`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token ?? adminToken}`,
      'x-organization-id': options.organizationId ?? mtdOrganizationId,
      'idempotency-key': options.idempotencyKey ?? randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
}

async function waitForCheckCount(itemId: string, expected: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const rows = await database.query<{ count: string }>(
      "select count(*)::text as count from mipres_checks where authorization_item_id = $1 and query_type = 'MANUAL'",
      [itemId],
    );
    if (Number.parseInt(rows.rows[0]?.count ?? '0', 10) >= expected) return;
    if (Date.now() > deadline) throw new Error(`Manual check count never reached ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function manualCheckCount(itemId: string): Promise<number> {
  const rows = await database.query<{ count: string }>(
    "select count(*)::text as count from mipres_checks where authorization_item_id = $1 and query_type = 'MANUAL'",
    [itemId],
  );
  return Number.parseInt(rows.rows[0]?.count ?? '0', 10);
}

describe('Gate F3', () => {
  beforeAll(async () => {
    await database.connect();
    [adminToken, olpToken] = await Promise.all([
      login('foundation-admin', 'foundation-admin'),
      login('olp-operator', 'olp-operator'),
    ]);
  });

  afterAll(async () => database.end());

  it('validates MIPRES directions end to end with stable outcomes and redacted evidence', async () => {
    const cases = [
      { suffix: '0', expected: 'CONFIRMED', expectedHttpStatus: 200, current: true },
      { suffix: '1', expected: 'PENDING', expectedHttpStatus: 200, current: null },
      { suffix: '2', expected: 'PENDING', expectedHttpStatus: 200, current: null },
      { suffix: '3', expected: 'PENDING', expectedHttpStatus: 200, current: null },
      { suffix: '4', expected: 'PENDING', expectedHttpStatus: 200, current: null },
      { suffix: '5', expected: 'QUERY_ERROR', expectedHttpStatus: 500, current: null },
      { suffix: '6', expected: 'QUERY_ERROR', expectedHttpStatus: 401, current: null },
      { suffix: '7', expected: 'QUERY_ERROR', expectedHttpStatus: 200, current: null },
    ] as const;

    for (const testCase of cases) {
      const { itemId, prescription } = await importNoPbsItem(testCase.suffix);
      const response = await requestRecheck(itemId);
      expect(response.status).toBe(202);
      const body = mipresRecheckRequestResponseSchema.parse(await response.json());
      expect(body).toMatchObject({
        itemId,
        status: 'QUEUED',
        queryType: 'MANUAL',
        correlationId: body.correlationId,
      });

      await waitForCheckCount(itemId, 1);
      const settled = await database.query<{ direction_status: string }>(
        'select direction_status from authorization_items where id = $1',
        [itemId],
      );
      expect(settled.rows[0]?.direction_status).toBe(testCase.expected);

      const checks = await database.query<{
        outcome: string;
        http_status: number | null;
        rule_version: string;
        response_payload: unknown;
        check_date: string | Date;
        direction_count: number;
      }>(
        `select outcome, http_status, rule_version, response_payload, check_date, direction_count
         from mipres_checks where authorization_item_id = $1 and query_type = 'MANUAL'
         order by queried_at desc`,
        [itemId],
      );
      const check = checks.rows[0];
      if (!check) throw new Error(`Expected a MIPRES check for ${testCase.suffix}`);
      expect(check.outcome).toBe(testCase.expected);
      expect(check.http_status).toBe(testCase.expectedHttpStatus);
      expect(check.rule_version).toBe('F3-MIPRES-1');
      const checkDate =
        check.check_date instanceof Date
          ? check.check_date.toISOString().slice(0, 10)
          : check.check_date;
      expect(checkDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(JSON.stringify(check.response_payload)).not.toContain('operative-token');
      expect(JSON.stringify(check.response_payload)).not.toContain('initial-secret');

      if (testCase.current !== null) {
        const directions = await database.query<{ current: boolean; annulled: boolean }>(
          'select current, annulled from mipres_directions where mipres_check_id = (select id from mipres_checks where authorization_item_id = $1 and query_type = $2)',
          [itemId, 'MANUAL'],
        );
        expect(directions.rows[0]).toMatchObject({ current: testCase.current, annulled: false });
      }

      const item = await database.query<{ enablement_status: string; coverage_type: string }>(
        'select enablement_status, coverage_type from authorization_items where id = $1',
        [itemId],
      );
      expect(item.rows[0]).toMatchObject({ enablement_status: 'ENABLED', coverage_type: 'NO_PBS' });
      expect(prescription).toMatch(/^\d+$/);
    }

    const audits = await database.query<{ action: string; actor_type: string }>(
      `select action, actor_type from audit_events
       where action in ('MIPRES_RECHECK_REQUESTED', 'DIRECTION_CONFIRMED', 'DIRECTION_NOT_FOUND', 'MIPRES_CHECK_COMPLETED')`,
    );
    const actions = new Set(audits.rows.map((row) => `${row.actor_type}:${row.action}`));
    expect(actions.has('USER:MIPRES_RECHECK_REQUESTED')).toBe(true);
    expect(actions.has('SYSTEM:DIRECTION_CONFIRMED')).toBe(true);
    expect(actions.has('SYSTEM:DIRECTION_NOT_FOUND')).toBe(true);
    expect(actions.has('SYSTEM:MIPRES_CHECK_COMPLETED')).toBe(true);
  });

  it('rejects a recheck for items that are not enabled NO_PBS records', async () => {
    const authorization = `AUTH-F3-PBS-${randomUUID()}`;
    const batch = await createImport(
      adminToken,
      authorizationCsv([
        { authorization, medication: 'MED-F3-PBS', prescripcion: '', status: '5' },
      ]),
    );
    await waitForBatch(adminToken, batch.id);
    await confirmImport(adminToken, batch.id);
    const items = await database.query<{ id: string }>(
      'select id from authorization_items where numero_autorizacion = $1',
      [authorization.toUpperCase()],
    );
    const itemId = items.rows[0]?.id;
    if (!itemId) throw new Error('Expected PBS item');
    const response = await requestRecheck(itemId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'MIPRES_RECHECK_NOT_APPLICABLE' });
  });

  it('rejects a recheck without the mipres.recheck permission', async () => {
    const { itemId } = await importNoPbsItem('0');
    const response = await requestRecheck(itemId, {
      token: olpToken,
      organizationId: olpOrganizationId,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('reuses the idempotency key without duplicating checks', async () => {
    const { itemId } = await importNoPbsItem('0');
    const idempotencyKey = randomUUID();
    const first = await requestRecheck(itemId, { idempotencyKey });
    expect(first.status).toBe(202);
    await waitForCheckCount(itemId, 1);
    const second = await requestRecheck(itemId, { idempotencyKey });
    expect(second.status).toBe(202);
    expect(mipresRecheckRequestResponseSchema.parse(await second.json())).toEqual(
      mipresRecheckRequestResponseSchema.parse(await first.clone().json()),
    );
    await waitForCheckCount(itemId, 1);
    expect(await manualCheckCount(itemId)).toBe(1);
  });

  it('does not duplicate checks when the outbox event is redelivered', async () => {
    const { itemId } = await importNoPbsItem('1');
    const response = await requestRecheck(itemId);
    expect(response.status).toBe(202);
    await waitForCheckCount(itemId, 1);
    const before = await manualCheckCount(itemId);
    expect(before).toBe(1);

    const redelivered = await database.query<{ id: string }>(
      `update outbox_events set status = 'PENDING', dispatched_at = null
       where event_type = 'authorization.mipres-recheck' and payload->>'itemId' = $1
       returning id`,
      [itemId],
    );
    expect(redelivered.rows).toHaveLength(1);
    const deadline = Date.now() + 15_000;
    for (;;) {
      const events = await database.query<{ status: string }>(
        `select status from outbox_events where event_type = 'authorization.mipres-recheck' and payload->>'itemId' = $1`,
        [itemId],
      );
      if (events.rows.every((row) => row.status === 'PROCESSED')) break;
      if (Date.now() > deadline) throw new Error('Outbox event never settled after redelivery');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(await manualCheckCount(itemId)).toBe(1);
  });

  it('rate limits manual rechecks per item and day with a stable error', async () => {
    const { itemId } = await importNoPbsItem('1');
    for (let index = 0; index < 3; index += 1) {
      const response = await requestRecheck(itemId);
      expect(response.status).toBe(202);
      await waitForCheckCount(itemId, index + 1);
    }
    const fourth = await requestRecheck(itemId);
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toMatchObject({ code: 'MIPRES_RECHECK_RATE_LIMITED' });
    expect(await manualCheckCount(itemId)).toBe(3);
  });

  it('keeps import rows readable after phase three changes', async () => {
    const { itemId, prescription } = await importNoPbsItem('0');
    const rows = await database.query<{ authorization_key: string }>(
      'select authorization_key from import_rows where authorization_item_id = $1 and result_code = $2',
      [itemId, 'ITEM_CREATED'],
    );
    expect(rows.rows[0]?.authorization_key).toContain(':');
    expect(prescription.startsWith('20260915123')).toBe(true);
  });
});
