import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, apiUrl, ensureOperatorTokens, ORGANIZATION_IDS } from './helpers/auth';
import { registerTariffProducts } from './helpers/tariff';
import { importBatchResponseSchema } from '../../packages/contracts/src/index.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = ORGANIZATION_IDS.MTD;
const prefix = `ADR027-${Date.now()}`;
const productCode = `${prefix}-PROD`;
const noPbsProductCode = `${prefix}-NO-PBS`;

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

type ImportRowInput = Readonly<{
  authorization: string;
  medication: string;
  prescripcion?: string;
  status?: string;
  vigencia?: string;
}>;

function csvValue(value: string): string {
  return /[;"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function authorizationCsv(rows: ImportRowInput[]): string {
  return [
    sourceColumns.map(csvValue).join(';'),
    ...rows.map((row) =>
      [
        'EPS-1',
        row.authorization,
        'CC',
        '123',
        'Paciente de prueba',
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
        row.vigencia ?? '2099-12-31',
        row.status ?? '5',
        row.prescripcion ?? '',
        'prueba ADR-027',
        'Medico de prueba',
        'comentario',
        'source-1',
        'FPRO-1',
        '0',
      ]
        .map(csvValue)
        .join(';'),
    ),
    '',
  ].join('\n');
}

async function createImport(content: string, filename = 'authorizations.csv'): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), filename);
  const response = await fetch(`${apiUrl}/api/v1/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  if (response.status !== 202)
    throw new Error(`Import creation failed: ${response.status} ${await response.text()}`);
  return importBatchResponseSchema.parse(await response.json()).id;
}

async function getBatch(batchId: string): Promise<{
  status: string;
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  confirmedRows: number;
  lastErrorCode: string | null;
}> {
  const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}`, {
    headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
  });
  return (await response.json()) as {
    status: string;
    totalRows: number;
    validRows: number;
    rejectedRows: number;
    confirmedRows: number;
    lastErrorCode: string | null;
  };
}

async function waitForBatch(
  batchId: string,
  ...terminal: string[]
): Promise<Awaited<ReturnType<typeof getBatch>>> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const batch = await getBatch(batchId);
    if (terminal.includes(batch.status)) return batch;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Batch ${batchId} never reached ${terminal.join('/')}`);
}

async function confirmBatch(batchId: string): Promise<{ status: string; createdRows: number }> {
  const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!response.ok) throw new Error(`Confirm failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { status: string; createdRows: number };
}

async function novelties(query: string): Promise<Array<Record<string, unknown>>> {
  const response = await fetch(`${apiUrl}/api/v1/novelties${query}`, {
    headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Array<Record<string, unknown>> }).items;
}

async function downloadNoveltiesCsv(
  query: string,
  token = adminToken,
  organizationId = mtdOrganizationId,
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${apiUrl}/api/v1/novelties/csv${query}`, {
    headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
  });
  return { status: response.status, text: await response.text() };
}

async function reprocess(itemId: string, token = adminToken): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/authorization-items/${itemId}/reprocess`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
}

async function itemIdByNumero(numero: string): Promise<string | null> {
  const result = await database.query<{ id: string }>(
    'select id from authorization_items where numero_autorizacion = $1',
    [numero],
  );
  return result.rows[0]?.id ?? null;
}

function rowInput(index: number, overrides: Partial<ImportRowInput> = {}): ImportRowInput {
  return { authorization: `${prefix}-A${index}`, medication: productCode, ...overrides };
}

async function cleanup(): Promise<void> {
  await database.query(
    `delete from novelties where import_batch_id in
      (select id from import_batches where original_filename like $1)
      or original_row->>'CODEPS' = $2 or authorization_item_id in
      (select id from authorization_items where numero_autorizacion like $1)`,
    [`${prefix}%`, 'EPS-1'],
  );
  await database.query(
    `delete from coverage_evaluations where authorization_item_id in (select id from authorization_items where numero_autorizacion like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from authorization_item_organizations where authorization_item_id in (select id from authorization_items where numero_autorizacion like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from validation_errors where import_row_id in (select r.id from import_rows r inner join import_batches b on b.id = r.import_batch_id where b.original_filename like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from import_rows where import_batch_id in (select id from import_batches where original_filename like $1)`,
    [`${prefix}%`],
  );
  await database.query(
    `delete from import_source_files where import_batch_id in (select id from import_batches where original_filename like $1)`,
    [`${prefix}%`],
  );
  await database.query(`delete from authorization_items where numero_autorizacion like $1`, [
    `${prefix}%`,
  ]);
  await database.query(`delete from import_batches where original_filename like $1`, [
    `${prefix}%`,
  ]);
  await database.query(`delete from tariff_annex_products where codigo_producto like $1`, [
    `${prefix}%`,
  ]);
}

describe('ADR-027 errores por registro en cargas masivas', () => {
  beforeAll(async () => {
    await database.connect();
    adminToken = await adminLogin();
    olpToken = (await ensureOperatorTokens()).olpToken;
    await cleanup();
    await registerTariffProducts(adminToken, [productCode]);
    await registerTariffProducts(adminToken, [noPbsProductCode], 'NO PBS');
  });

  afterAll(async () => {
    await cleanup();
    await database.end();
  });

  it('caso 1: archivo 100% válido procesa todos los registros', async () => {
    const batchId = await createImport(
      authorizationCsv([rowInput(1), rowInput(2)]),
      `${prefix}-ok.csv`,
    );
    const ready = await waitForBatch(batchId, 'READY_TO_CONFIRM');
    expect(ready.totalRows).toBe(2);
    expect(ready.validRows).toBe(2);
    expect(ready.rejectedRows).toBe(0);
    const confirmed = await confirmBatch(batchId);
    expect(confirmed.createdRows).toBe(2);
    const pending = await novelties(`?batchId=${batchId}`);
    expect(pending).toHaveLength(0);
  });

  it('caso 2: archivo estructuralmente inválido rechaza el lote completo', async () => {
    const batchId = await createImport('cualquier cosa\nsin contrato', `${prefix}-bad.txt`);
    const failed = await waitForBatch(batchId, 'FAILED');
    expect(failed.status).toBe('FAILED');
    expect(failed.lastErrorCode).toBeTruthy();
    const items = await database.query<{ total: number }>(
      `select count(*)::int as total from authorization_items where numero_autorizacion like $1`,
      [`${prefix}-BAD%`],
    );
    expect(items.rows[0]?.total).toBe(0);
  });

  it('caso 3: parcialmente inválido — los válidos se confirman y los inválidos quedan en la bandeja', async () => {
    const rows: ImportRowInput[] = [];
    for (let index = 10; index < 20; index += 1) rows.push(rowInput(index));
    rows.push(rowInput(20, { authorization: '' }));
    rows.push(rowInput(21, { medication: noPbsProductCode, prescripcion: '12' }));
    const batchId = await createImport(authorizationCsv(rows), `${prefix}-partial.csv`);
    const ready = await waitForBatch(batchId, 'READY_TO_CONFIRM');
    expect(ready.totalRows).toBe(12);
    expect(ready.validRows).toBe(10);
    expect(ready.rejectedRows).toBe(2);
    const confirmed = await confirmBatch(batchId);
    expect(confirmed.createdRows).toBe(10);
    const pending = await novelties(`?batchId=${batchId}`);
    expect(pending).toHaveLength(2);
    const codes = pending.map((item) => `${String(item.code)}:${String(item.errorType)}`).sort();
    expect(codes).toEqual(['CLS_001:CORREGIBLE_POR_CARGUE', 'CSV_004:CORREGIBLE_POR_CARGUE']);
    for (const item of pending) {
      expect(item.status).toBe('PENDIENTE');
      expect(item.stage).toBeTruthy();
      expect(item.importBatchId).toBe(batchId);
    }
  });

  it('caso 4: descarga de rechazados conserva columnas originales y diagnósticos', async () => {
    const batchId = (
      await database.query<{ id: string }>(
        `select b.id from import_batches b where b.original_filename = $1 limit 1`,
        [`${prefix}-partial.csv`],
      )
    ).rows[0]!.id;
    const exported = await downloadNoveltiesCsv(`?batchId=${batchId}`);
    expect(exported.status).toBe(200);
    const lines = exported.text.split('\r\n').filter((line) => line !== '');
    const header = lines[0]!.split(';');
    for (const column of [
      'NUMERO_AUTORIZACION',
      'CODIGO_COMERCIAL',
      'ESTADO_PROCESAMIENTO',
      'ETAPA_ERROR',
      'CODIGO_ERROR',
      'TIPO_ERROR',
      'DESCRIPCION_ERROR',
    ]) {
      expect(header).toContain(column);
    }
    expect(header.slice(-5)).toEqual([
      'ESTADO_PROCESAMIENTO',
      'ETAPA_ERROR',
      'CODIGO_ERROR',
      'TIPO_ERROR',
      'DESCRIPCION_ERROR',
    ]);
    expect(lines).toHaveLength(3);
    for (const line of lines.slice(1)) {
      expect(line).toContain('PENDIENTE');
      expect(line).toContain('CORREGIBLE_POR_CARGUE');
    }
  });

  it('caso 5: recarga parcial de los corregidos sin duplicar ni reprocesar los válidos', async () => {
    const firstBatch = (
      await database.query<{ id: string }>(
        `select b.id from import_batches b where b.original_filename = $1 limit 1`,
        [`${prefix}-partial.csv`],
      )
    ).rows[0]!;
    const itemsBefore = await database.query<{ total: number }>(
      `select count(*)::int as total from authorization_items where numero_autorizacion like $1`,
      [`${prefix}%`],
    );
    const reload = await createImport(
      authorizationCsv([
        rowInput(20),
        rowInput(21, { medication: noPbsProductCode, prescripcion: '12345678901234567890' }),
      ]),
      `${prefix}-corrected.csv`,
    );
    await waitForBatch(reload, 'READY_TO_CONFIRM');
    const confirmed = await confirmBatch(reload);
    expect(confirmed.createdRows).toBe(2);
    const itemsAfter = await database.query<{ total: number }>(
      `select count(*)::int as total from authorization_items where numero_autorizacion like $1`,
      [`${prefix}%`],
    );
    expect(itemsAfter.rows[0]?.total).toBe(itemsBefore.rows[0]!.total + 2);
    const stillPending = await novelties(`?batchId=${firstBatch.id}`);
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0]?.code).toBe('CSV_004');
    const resolved = await novelties(`?batchId=${firstBatch.id}&status=RESUELTO`);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.code).toBe('CLS_001');
    const duplicates = await database.query(
      `select numero_autorizacion, codigo_medicamento, count(*)::int as total
         from authorization_items where numero_autorizacion like $1
        group by 1, 2 having count(*) > 1`,
      [`${prefix}%`],
    );
    expect(duplicates.rows).toHaveLength(0);
  });

  it('caso 6 y 7: producto inexistente detiene el registro y crearlo después lo libera sin recargar', async () => {
    const missingProduct = `${prefix}-LATE`;
    const batchId = await createImport(
      authorizationCsv([rowInput(30, { medication: missingProduct })]),
      `${prefix}-late-product.csv`,
    );
    await waitForBatch(batchId, 'READY_TO_CONFIRM');
    const confirmed = await confirmBatch(batchId);
    expect(confirmed.createdRows).toBe(0);
    const itemId = await itemIdByNumero(`${prefix}-A30`);
    expect(itemId).toBeTruthy();
    const blocked = await database.query<{ operation_status: string; process_status: string }>(
      'select operation_status, process_status from authorization_items where id = $1',
      [itemId!],
    );
    expect(blocked.rows[0]?.operation_status).toBe('BLOCKED');
    expect(blocked.rows[0]?.process_status).toBe('NOVEDAD');
    const pending = await novelties(`?batchId=${batchId}`);
    expect(pending.map((item) => item.code)).toContain('ANX_001');
    const anxNovelty = pending.find((item) => item.code === 'ANX_001')!;
    expect(anxNovelty.errorType).toBe('REPROCESABLE_INTERNAMENTE');

    await registerTariffProducts(adminToken, [missingProduct]);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const item = await database.query<{ operation_status: string }>(
        'select operation_status from authorization_items where id = $1',
        [itemId!],
      );
      if (item.rows[0]?.operation_status === 'READY_TO_DISPENSE') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const finalItem = await database.query<{ operation_status: string; process_status: string }>(
      'select operation_status, process_status from authorization_items where id = $1',
      [itemId!],
    );
    expect(finalItem.rows[0]?.operation_status).toBe('READY_TO_DISPENSE');
    expect(finalItem.rows[0]?.process_status).toBe('LISTO_PARA_DISPENSAR');
    const afterRevalidation = await novelties(`?code=ANX_001&authorization=${prefix}-A30`);
    expect(afterRevalidation).toHaveLength(0);
    const resolvedAnx = await database.query<{ total: number }>(
      `select count(*)::int as total from audit_events where action = 'NOVELTY_RESOLVED'`,
    );
    expect(Number(resolvedAnx.rows[0]?.total ?? 0)).toBeGreaterThan(0);
  });

  it('caso 8: repetir la misma carga es idempotente y no duplica ítems', async () => {
    const before = await database.query<{ total: number }>(
      `select count(*)::int as total from authorization_items where numero_autorizacion like $1`,
      [`${prefix}%`],
    );
    const batchId = await createImport(
      authorizationCsv([rowInput(10), rowInput(11)]),
      `${prefix}-repeat.csv`,
    );
    const ready = await waitForBatch(batchId, 'READY_TO_CONFIRM');
    expect(ready.validRows).toBe(0);
    const confirmed = await confirmBatch(batchId);
    expect(confirmed.createdRows).toBe(0);
    const after = await database.query<{ total: number }>(
      `select count(*)::int as total from authorization_items where numero_autorizacion like $1`,
      [`${prefix}%`],
    );
    expect(after.rows[0]?.total).toBe(before.rows[0]!.total);
  });

  it('caso 9: usuarios sin permisos reciben 403 en reprocesar desde la API', async () => {
    const itemId = await itemIdByNumero(`${prefix}-A10`);
    expect(itemId).toBeTruthy();
    const forbidden = await reprocess(itemId!, olpToken);
    expect(forbidden.status).toBe(403);
    const forbiddenBody = (await forbidden.json()) as { code?: string };
    expect(forbiddenBody.code).toBeTruthy();
  });

  it('reprocesar con control humano re-evalúa y preserva causales restantes', async () => {
    const itemId = await itemIdByNumero(`${prefix}-A10`);
    const response = await reprocess(itemId!);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      operationStatus: string | null;
      resolvedNovelties: number;
      remainingCausales: string[];
    };
    expect(body.operationStatus).toBe('READY_TO_DISPENSE');
    expect(body.resolvedNovelties).toBe(0);
    const pending = await novelties(`?authorization=${prefix}-A10`);
    expect(pending).toHaveLength(0);
  });

  it('caso 10: carga con 200 filas y errores dispersos procesa el parcial sin revocar lo válido', async () => {
    const rows: ImportRowInput[] = [];
    for (let index = 100; index < 300; index += 1) {
      const invalid = index % 20 === 0;
      rows.push(rowInput(index, invalid ? { prescripcion: '7' } : {}));
    }
    const batchId = await createImport(authorizationCsv(rows), `${prefix}-large.csv`);
    const ready = await waitForBatch(batchId, 'READY_TO_CONFIRM');
    expect(ready.totalRows).toBe(200);
    expect(ready.validRows).toBe(190);
    expect(ready.rejectedRows).toBe(10);
    const confirmed = await confirmBatch(batchId);
    expect(confirmed.createdRows).toBe(190);
    const pending = await novelties(`?batchId=${batchId}&limit=500`);
    expect(pending).toHaveLength(10);
    const items = await database.query<{ total: number }>(
      `select count(*)::int as total from authorization_items where numero_autorizacion like $1`,
      [`${prefix}-A1%`],
    );
    expect(items.rows[0]!.total).toBeGreaterThanOrEqual(100);
  });
});
