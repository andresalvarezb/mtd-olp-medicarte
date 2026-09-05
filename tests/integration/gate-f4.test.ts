import { randomUUID } from 'node:crypto';
import { loginDev } from './helpers/auth';
import { registerTariffProducts } from './helpers/tariff';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
const medicarteOrganizationId = '10000000-0000-4000-8000-000000000004';

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

const locationHeader = 'authorization_key,lugar_dispensacion,fecha_programada,cod_autorizacion_medicarte';

const database = new Client({ connectionString: databaseUrl });
let adminToken: string;
let olpToken: string;
let medicarteToken: string;

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
        'Paciente de prueba F4',
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
        'prueba F4',
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
): Promise<{ status: string; validRows: number }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': mtdOrganizationId },
    });
    if (response.ok) {
      const batch = (await response.json()) as { status: string; validRows: number };
      if (batch.status === 'READY_TO_CONFIRM' || batch.status === 'COMPLETED') return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Import batch never became ready');
}

async function confirmImport(
  token: string,
  batchId: string,
  idempotencyKey?: string,
): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/imports/${batchId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': idempotencyKey ?? randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
}

async function confirmReadyItem(suffix: string): Promise<string> {
  const authorization = `AUTH-F4-${randomUUID()}`;
  const medication = `MED-F4-${suffix}`.toUpperCase();
  await registerTariffProducts(adminToken, [medication]);
  const batch = await createImport(
    adminToken,
    authorizationCsv([{ authorization, medication, prescripcion: '', status: '5' }]),
  );
  await waitForBatch(adminToken, batch.id);
  const confirmation = await confirmImport(adminToken, batch.id);
  expect(confirmation.status).toBe(200);
  const items = await database.query<{ id: string; operation_status: string | null }>(
    'select id, operation_status from authorization_items where numero_autorizacion = $1',
    [authorization.toUpperCase()],
  );
  const item = items.rows[0];
  if (!item) throw new Error('Expected item to be confirmed');
  expect(item.operation_status).toBe('READY_TO_DISPENSE');
  return item.id;
}

async function itemKey(itemId: string): Promise<string> {
  const keyRows = await database.query<{ authorization_key: string }>(
    'select authorization_key from authorization_items where id = $1',
    [itemId],
  );
  const authorizationKey = keyRows.rows[0]?.authorization_key;
  if (!authorizationKey) throw new Error('Expected authorization key');
  return authorizationKey;
}

async function createBulkBatch(
  token: string,
  organizationId: string,
  content: string,
  idempotencyKey = randomUUID(),
): Promise<Response> {
  const form = new FormData();
  form.append('operationType', 'ASSIGN_DISPENSATION_LOCATION');
  form.append('file', new Blob([content], { type: 'text/csv' }), 'locations.csv');
  return fetch(`${apiUrl}/api/v1/bulk-updates`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      'idempotency-key': idempotencyKey,
    },
    body: form,
  });
}

async function waitForBulkBatch(
  token: string,
  organizationId: string,
  batchId: string,
): Promise<{
  id: string;
  status: string;
  lastErrorCode: string | null;
  totalRows: number;
  processedRows: number;
  updatedRows: number;
  unchangedRows: number;
  rejectedRows: number;
}> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/v1/bulk-updates/${batchId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
    });
    if (response.ok) {
      const batch = (await response.json()) as { status: string };
      if (batch.status === 'COMPLETED' || batch.status === 'FAILED')
        return batch as {
          id: string;
          status: string;
          lastErrorCode: string | null;
          totalRows: number;
          processedRows: number;
          updatedRows: number;
          unchangedRows: number;
          rejectedRows: number;
        };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Bulk update batch never settled');
}

function locationCsv(
  rows: Array<{
    authorizationKey: string;
    location: string;
    scheduledDate?: string;
    medicarteCode?: string;
  }>,
): string {
  return [
    locationHeader,
    ...rows.map((row) =>
      csvRow([
        row.authorizationKey,
        row.location,
        row.scheduledDate ?? '2026-10-01',
        row.medicarteCode ?? `MEDCAR-${row.location.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`,
      ]),
    ),
    '',
  ].join('\n');
}

describe('Gate F4', () => {
  beforeAll(async () => {
    await database.connect();
    [adminToken, olpToken, medicarteToken] = await Promise.all([
      login('foundation-admin', 'foundation-admin'),
      login('olp-operator', 'olp-operator'),
      login('medicarte-operator', 'medicarte-operator'),
    ]);
  });

  afterAll(async () => database.end());

  it('confirma disponibilidad con trazabilidad y sin efectos de notificación (alcance vigente)', async () => {
    const itemId = await confirmReadyItem('ready');
    const audits = await database.query<{ action: string }>(
      `select action from audit_events
       where action = 'AUTHORIZATION_READY_TO_DISPENSE' and resource_id = $1`,
      [itemId],
    );
    expect(audits.rows.length).toBeGreaterThan(0);
    const notificationEvents = await database.query<{ count: string }>(
      `select count(*)::text as count from outbox_events where event_type = 'notification.email'`,
    );
    expect(notificationEvents.rows[0]?.count).toBe('0');
  });

  it(
    'procesa el lote MEDICARTE de lugar_dispensacion con historial y evento por versión',
    { timeout: 90_000 },
    async () => {
      const itemId = await confirmReadyItem('bulk');
      const authorizationKey = await itemKey(itemId);

      // Actor incorrecto: OLP no puede ejecutar la operación de MEDICARTE.
      const forbidden = await createBulkBatch(olpToken, olpOrganizationId, '');
      expect(forbidden.status).toBe(403);

      // Columna extra: el archivo completo se rechaza con INVALID_HEADERS.
      const extraColumns = await createBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        `${locationHeader},extra\n${csvRow([authorizationKey, 'Calle 1', '2026-10-01', 'M1', 'X'])}\n`,
      );
      expect(extraColumns.status).toBe(202);
      const extraBatchId = ((await extraColumns.json()) as { id: string }).id;
      const extraBatch = await waitForBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        extraBatchId,
      );
      expect(extraBatch.status).toBe('FAILED');
      expect(extraBatch.lastErrorCode).toBe('INVALID_HEADERS');

      // Primera asignación.
      const first = await createBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        locationCsv([{ authorizationKey, location: 'Calle 40 # 12-34' }]),
      );
      expect(first.status).toBe(202);
      const firstBatch = await waitForBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        ((await first.json()) as { id: string }).id,
      );
      expect(firstBatch).toMatchObject({ status: 'COMPLETED', updatedRows: 1, rejectedRows: 0 });
      const afterFirst = await database.query<{
        lugar_dispensacion: string;
        fecha_programada: string;
        cod_autorizacion_medicarte: string | null;
        operational_version: number;
      }>(
        `select lugar_dispensacion, fecha_programada::text, cod_autorizacion_medicarte,
                operational_version from authorization_items where id = $1`,
        [itemId],
      );
      expect(afterFirst.rows[0]).toMatchObject({
        lugar_dispensacion: 'Calle 40 # 12-34',
        fecha_programada: '2026-10-01',
        cod_autorizacion_medicarte: expect.any(String) as string,
        operational_version: 1,
      });

      // Cambio real → nueva versión.
      const second = await createBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        locationCsv([{ authorizationKey, location: 'Carrera 7 # 45-67' }]),
      );
      const secondBatch = await waitForBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        ((await second.json()) as { id: string }).id,
      );
      expect(secondBatch).toMatchObject({ status: 'COMPLETED', updatedRows: 1 });
      const afterSecond = await database.query<{ lugar_dispensacion: string; operational_version: number }>(
        `select lugar_dispensacion, operational_version from authorization_items where id = $1`,
        [itemId],
      );
      expect(afterSecond.rows[0]).toMatchObject({
        lugar_dispensacion: 'Carrera 7 # 45-67',
        operational_version: 2,
      });

      // Valor idéntico (tras normalizar espacios) → UNCHANGED_VALUE sin nueva
      // versión. El archivo difiere en bytes del anterior para no deduplicar
      // por file_hash (SPEC-009).
      const third = await createBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        locationCsv([{ authorizationKey, location: '  Carrera  7  #  45-67  ' }]),
      );
      const thirdBatch = await waitForBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        ((await third.json()) as { id: string }).id,
      );
      expect(thirdBatch).toMatchObject({ status: 'COMPLETED', unchangedRows: 1, updatedRows: 0 });

      // Historial append-only con antes/después, actor, lote, fila y versión.
      const changes = await database.query<{
        previous_value: string | null;
        new_value: string;
        new_operational_version: number;
        field_name: string;
      }>(
        `select field_name, previous_value, new_value, new_operational_version
         from operational_field_changes where authorization_item_id = $1 order by created_at asc`,
        [itemId],
      );
      const lugarChanges = changes.rows.filter((row) => row.field_name === 'LUGAR_DISPENSACION');
      expect(lugarChanges).toHaveLength(2);
      expect(lugarChanges[0]).toMatchObject({
        previous_value: null,
        new_value: 'Calle 40 # 12-34',
        new_operational_version: 1,
      });
      expect(lugarChanges[1]).toMatchObject({
        previous_value: 'Calle 40 # 12-34',
        new_value: 'Carrera 7 # 45-67',
        new_operational_version: 2,
      });

      // Asignar lugar avanza la etapa funcional del flujo objetivo.
      const process = await database.query<{ process_status: string | null }>(
        'select process_status from authorization_items where id = $1',
        [itemId],
      );
      expect(['PENDIENTE_ORDEN_COMPRA', 'PENDIENTE_DISPENSACION']).toContain(
        process.rows[0]?.process_status,
      );
    },
  );

  it(
    'rechaza filas fuera de alcance, sin llave o con valor vacío sin revertir las válidas',
    { timeout: 60_000 },
    async () => {
      const readyItemId = await confirmReadyItem('mixed');
      const readyKey = await itemKey(readyItemId);
      const batch = await createBulkBatch(
        medicarteToken,
        medicarteOrganizationId,
        [
          locationHeader,
          csvRow([readyKey, '   ', '2026-10-01', 'M-BLANK']),
          csvRow([readyKey, 'Calle valida 1', '2026-10-01', 'M-OK']),
          csvRow(['FUERA:LEJA', 'Calle fuera de alcance', '2026-10-01', 'M-X']),
          csvRow(['', 'Sin llave', '2026-10-01', 'M-Y']),
          '',
        ].join('\n'),
      );
      expect(batch.status).toBe(202);
      const batchId = ((await batch.json()) as { id: string }).id;
      const result = await waitForBulkBatch(medicarteToken, medicarteOrganizationId, batchId);
      // ADR-027: un archivo parcialmente inválido aplica las filas válidas.
      expect(result.status).toBe('COMPLETED');
      expect(result.updatedRows).toBe(1);
      expect(result.rejectedRows).toBeGreaterThanOrEqual(2);
      const rows = await database.query<{ row_number: number; result_code: string }>(
        `select row_number, result_code from bulk_update_rows where batch_id = $1 order by row_number`,
        [batchId],
      );
      const byRow = new Map(rows.rows.map((row) => [row.row_number, row.result_code]));
      expect(byRow.get(2)).toBe('MISSING_VALUE');
      expect(byRow.get(3)).toBe('ROW_UPDATED');
      expect(byRow.get(4)).toBe('AUTHORIZATION_ITEM_NOT_FOUND');
      expect(byRow.get(5)).toBe('MISSING_BUSINESS_KEY');
      const updated = await database.query<{ lugar_dispensacion: string }>(
        'select lugar_dispensacion from authorization_items where id = $1',
        [readyItemId],
      );
      expect(updated.rows[0]?.lugar_dispensacion).toBe('Calle valida 1');

      // ADR-027: cada fila rechazada queda en la bandeja transversal con su
      // causal, lote, fila y evidencia original.
      const novelties = await database.query<{
        code: string;
        stage: string;
        source_row_number: number | null;
      }>(
        `select n.code, n.stage, n.source_row_number from novelties n
          where n.bulk_update_batch_id = $1 order by n.source_row_number`,
        [batchId],
      );
      expect(novelties.rows.map((row) => `${row.code}@${row.source_row_number}`)).toEqual([
        'CSV_004@2',
        'LOCK_001@4',
        'CSV_004@5',
      ]);
      expect(new Set(novelties.rows.map((row) => row.stage))).toEqual(new Set(['ASSIGN_DISPENSATION_LOCATION']));
    },
  );

  it('el reprocesamiento de una fila corregida cierra la novedad anterior', async () => {
    const readyItemId = await confirmReadyItem('resolve');
    const readyKey = await itemKey(readyItemId);
    const failing = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      [locationHeader, csvRow([readyKey, '   ', '2026-10-01', 'M-EMPTY']), ''].join('\n'),
    );
    const failingId = ((await failing.json()) as { id: string }).id;
    await waitForBulkBatch(medicarteToken, medicarteOrganizationId, failingId);
    const before = await database.query<{ total: string }>(
      `select count(*)::text as total from novelties
        where bulk_update_batch_id = $1 and active = true`,
      [failingId],
    );
    expect(Number(before.rows[0]?.total ?? '0')).toBe(1);

    const fixed = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      locationCsv([{ authorizationKey: readyKey, location: 'Calle corregida 5' }]),
    );
    const fixedId = ((await fixed.json()) as { id: string }).id;
    const fixedResult = await waitForBulkBatch(medicarteToken, medicarteOrganizationId, fixedId);
    expect(fixedResult).toMatchObject({ status: 'COMPLETED', updatedRows: 1 });

    const after = await database.query<{ total: string }>(
      `select count(*)::text as total from novelties
        where bulk_update_batch_id = $1 and active = true`,
      [failingId],
    );
    expect(Number(after.rows[0]?.total ?? '0')).toBe(0);
    const resolutionAudits = await database.query<{ total: string }>(
      `select count(*)::text as total from audit_events
        where action = 'NOVELTY_RESOLVED'`,
    );
    expect(Number(resolutionAudits.rows[0]?.total ?? '0')).toBeGreaterThan(0);
  });
});
