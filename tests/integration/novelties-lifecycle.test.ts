import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginDev, apiUrl, ORGANIZATION_IDS } from './helpers/auth';
import { XLSX_MIME_TYPE, xlsxBuffer } from './helpers/xlsx';
import { insertNovelty, resolveNovelties } from '../../packages/database/src/novelties';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = ORGANIZATION_IDS.MTD;

const database = new Client({ connectionString: databaseUrl });
let adminToken: string;

type NoveltyDbRow = {
  id: string;
  code: string;
  logical_key: string;
  attempt_number: number;
  active: boolean;
};

async function noveltiesByKey(logicalKey: string): Promise<NoveltyDbRow[]> {
  const result = await database.query<NoveltyDbRow>(
    `select id, code, logical_key, attempt_number, active from novelties
      where logical_key = $1 order by attempt_number`,
    [logicalKey],
  );
  return result.rows;
}

async function itemCount(logicalKey: string): Promise<number> {
  const result = await database.query<{ total: number }>(
    'select count(*)::int as total from novelties where logical_key = $1',
    [logicalKey],
  );
  return result.rows[0]!.total;
}

async function seedItem(prefix: string): Promise<{ id: string; key: string }> {
  const itemId = randomUUID();
  const batchId = randomUUID();
  const numero = `AUTH-NOV-${prefix}-${randomUUID()}`.toUpperCase();
  const medication = `MED-NOV-${prefix}`.toUpperCase();
  const key = `${numero}:${medication}`;
  const user = await database.query<{ id: string }>(
    "select id from users where username = 'foundation-admin'",
  );
  await database.query(
    `insert into import_batches
       (id, organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
        processor_version, status, total_rows, valid_rows, confirmed_rows)
     values ($1, $2, $3, 'nov.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, $4, 1, 'COMPLETED', 1, 1, 1)`,
    [
      batchId,
      mtdOrganizationId,
      user.rows[0]!.id,
      randomUUID().replaceAll('-', '').padEnd(64, '0'),
    ],
  );
  await database.query(
    `insert into authorization_items
       (id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
        source_status_normalized, source_prescripcion_normalized, no_prescripcion,
        enablement_status, coverage_type, direction_status, operation_status,
        coverage_rule_version, audit_status, tariff_membership_status, created_from_batch_id)
     values ($1, $2, $3, $4, '{}'::jsonb, '5', '', '', 'ENABLED', 'PBS', 'NOT_APPLICABLE',
             'READY_TO_DISPENSE', 'F2-COVERAGE-2', 'NOT_STARTED', 'LISTED', $5)`,
    [itemId, numero, medication, key, batchId],
  );
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2)`,
    [itemId, mtdOrganizationId],
  );
  return { id: itemId, key };
}

async function rejectBulkRow(input: {
  itemId: string | null;
  code: string;
  stage: string;
  field: string | null;
  actorId: string;
  rowNumber?: number;
}): Promise<void> {
  const batchId = randomUUID();
  await database.query(
    `insert into bulk_update_batches
       (id, organization_id, created_by, operation_type, contract_version, original_filename,
        mime_type, size_bytes, sha256, status, correlation_id, idempotency_key)
     values ($1, $2, $3, $4, 1, 'nov.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
             1, $5, 'COMPLETED', $6, $7)`,
    [
      batchId,
      mtdOrganizationId,
      input.actorId,
      input.stage,
      randomUUID().replaceAll('-', '').padEnd(64, '0'),
      randomUUID(),
      `reconcile:${batchId}`,
    ],
  );
  await database.query('begin');
  await insertNovelty(database, {
    authorizationItemId: input.itemId,
    bulkUpdateBatchId: batchId,
    sourceRowNumber: input.rowNumber ?? 2,
    originalRow: { authorization_key: 'k', lugar_dispensacion: 'x' },
    code: input.code,
    stage: input.stage,
    field: input.field,
    receivedValue: null,
    description: 'La etapa esta bloqueada por avance del proceso.',
    actorId: input.actorId,
    correlationId: randomUUID(),
  });
  await database.query('commit');
}

const tariffHeaders = [
  'CODIGO_MEDICAMENTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA_MEDICAMENTO',
  'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  'LABORATORIO_MEDICAMENTO',
  'TIPO_INCLUSION_MEDICAMENTO',
];

async function uploadTariffImport(rows: Array<Array<string>>): Promise<{ id: string }> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([xlsxBuffer([tariffHeaders, ...rows])], { type: XLSX_MIME_TYPE }),
    `novelty-${randomUUID()}.xlsx`,
  );
  const response = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  expect(response.status).toBe(202);

  const batch = (await response.json()) as { id: string };

  const confirm = await fetch(
    `${apiUrl}/api/v1/admin/tariff-annex/imports/${batch.id}/confirm`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': mtdOrganizationId,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: '{}',
    },
  );

  expect(confirm.status).toBe(200);

  return batch;
}

async function waitForTariffImport(batchId: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/imports/${batchId}`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    const value = (await status.json()) as { status: string };
    if (value.status === 'COMPLETED' || value.status === 'FAILED') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Tariff import never finished: ${batchId}`);
}

describe('TASK-NOV-001 — ciclo de vida de novedades', () => {
  beforeAll(async () => {
    await database.connect();
    adminToken = await loginDev('foundation-admin', 'foundation-admin');
  });

  afterAll(async () => database.end());

  it('LOCK_001 que falla tres veces conserva historico 3 con una sola activa', async () => {
    const item = await seedItem('three');
    const actor = (
      await database.query<{ id: string }>(
        "select id from users where username = 'foundation-admin'",
      )
    ).rows[0]!.id;
    const logicalKey = `ITEM|${item.id}|LOCK_001|ASSIGN_DISPENSATION_LOCATION|lugar_dispensacion`;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await rejectBulkRow({
        itemId: item.id,
        code: 'LOCK_001',
        stage: 'ASSIGN_DISPENSATION_LOCATION',
        field: 'lugar_dispensacion',
        actorId: actor,
        rowNumber: attempt,
      });
    }
    const rows = await noveltiesByKey(logicalKey);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.attempt_number)).toEqual([1, 2, 3]);
    expect(rows.filter((row) => row.active)).toHaveLength(1);
    expect(rows.find((row) => row.active)!.attempt_number).toBe(3);

    // attemptCount histórico en la bandeja aunque el filtro sea active=true.
    const listed = await database.query<{ attempt_number: number; attempt_count: string }>(
      `select n.attempt_number,
              (select count(*)::text from novelties hn where hn.logical_key = n.logical_key) as attempt_count
         from novelties n where n.logical_key = $1 and n.active = true`,
      [logicalKey],
    );
    expect(listed.rows[0]).toEqual({ attempt_number: 3, attempt_count: '3' });
  });

  it('LOCK_001 falla y luego funciona: cero activas con historico intacto', async () => {
    const item = await seedItem('resolve');
    const actor = (
      await database.query<{ id: string }>(
        "select id from users where username = 'foundation-admin'",
      )
    ).rows[0]!.id;
    const logicalKey = `ITEM|${item.id}|LOCK_001|ASSIGN_PURCHASE_ORDER|orden_compra`;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await rejectBulkRow({
        itemId: item.id,
        code: 'LOCK_001',
        stage: 'ASSIGN_PURCHASE_ORDER',
        field: 'orden_compra',
        actorId: actor,
        rowNumber: attempt,
      });
    }
    await database.query('begin');
    const resolved = await resolveNovelties(database, {
      authorizationItemId: item.id,
      codes: ['CSV_002', 'CSV_004', 'CSV_005', 'LOCK_001', 'CONC_001', 'TECH_001'],
      reason: 'BULK_UPDATE_APPLIED:ASSIGN_PURCHASE_ORDER',
      actorType: 'USER',
      actorId: actor,
      organizationId: mtdOrganizationId,
      correlationId: randomUUID(),
    });
    await database.query('commit');
    expect(resolved).toBe(1);
    expect(await itemCount(logicalKey)).toBe(2);
    expect((await noveltiesByKey(logicalKey)).filter((row) => row.active)).toHaveLength(0);
  });

  it('dos fallos concurrentes de la misma causal dejan maximo una activa', async () => {
    const item = await seedItem('concurrent');
    const actor = (
      await database.query<{ id: string }>(
        "select id from users where username = 'foundation-admin'",
      )
    ).rows[0]!.id;
    const firstClient = new Client({ connectionString: databaseUrl });
    const secondClient = new Client({ connectionString: databaseUrl });
    await firstClient.connect();
    await secondClient.connect();
    try {
      await firstClient.query('begin');
      await secondClient.query('begin');
      const noveltyInput = {
        authorizationItemId: item.id,
        bulkUpdateBatchId: (
          await database.query<{ id: string }>(
            "insert into bulk_update_batches (id, organization_id, created_by, operation_type, contract_version, original_filename, mime_type, size_bytes, sha256, status, correlation_id, idempotency_key) values (gen_random_uuid(), $1, $2, 'ASSIGN_DISPENSATION_LOCATION', 1, 'nov.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, $3, 'COMPLETED', gen_random_uuid(), $4) returning id",
            [
              mtdOrganizationId,
              actor,
              randomUUID().replaceAll('-', '').padEnd(64, '0'),
              `concurrent:${randomUUID()}`,
            ],
          )
        ).rows[0]!.id,
        sourceRowNumber: 7,
        originalRow: { authorization_key: 'k' },
        code: 'LOCK_001',
        stage: 'ASSIGN_DISPENSATION_LOCATION',
        field: 'lugar_dispensacion',
        receivedValue: null,
        description: 'La etapa esta bloqueada por avance del proceso.',
        actorId: actor,
        correlationId: randomUUID(),
      };
      await insertNovelty(firstClient, noveltyInput);
      const second = insertNovelty(secondClient, noveltyInput);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await firstClient.query('commit');
      await second;
      await secondClient.query('commit');
    } finally {
      await firstClient.end();
      await secondClient.end();
    }
    const rows = await noveltiesByKey(
      `ITEM|${item.id}|LOCK_001|ASSIGN_DISPENSATION_LOCATION|lugar_dispensacion`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.attempt_number)).toEqual([1, 2]);
    expect(rows.filter((row) => row.active)).toHaveLength(1);
  });

  it('causales distintas (codigo, stage o field) no se superseden entre si', async () => {
    const item = await seedItem('distinct');
    const actor = (
      await database.query<{ id: string }>(
        "select id from users where username = 'foundation-admin'",
      )
    ).rows[0]!.id;
    await rejectBulkRow({
      itemId: item.id,
      code: 'LOCK_001',
      stage: 'ASSIGN_DISPENSATION_LOCATION',
      field: 'lugar_dispensacion',
      actorId: actor,
    });
    await rejectBulkRow({
      itemId: item.id,
      code: 'CONC_001',
      stage: 'ASSIGN_DISPENSATION_LOCATION',
      field: 'lugar_dispensacion',
      actorId: actor,
    });
    await rejectBulkRow({
      itemId: item.id,
      code: 'LOCK_001',
      stage: 'REPORT_APPLICATION_DATE',
      field: 'fecha_aplicacion',
      actorId: actor,
    });
    const active = await database.query<{ code: string; stage: string; field: string | null }>(
      `select code, stage, field from novelties where authorization_item_id = $1 and active = true`,
      [item.id],
    );
    expect(active.rows).toHaveLength(3);
  });

  it('error tecnico del anexo se cierra cuando el mismo producto se carga correctamente; producto ausente sigue pendiente', async () => {
    const productX = `NOVX-${randomUUID()}`;
    const productY = `NOVY-${randomUUID()}`;
    const firstBatch = await uploadTariffImport([
      [productX, '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
      [productX, '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
      [productY, '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
      [productY, '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
      ['', '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
    ]);
    await waitForTariffImport(firstBatch.id);
    const xKey = (
      await database.query<{ logical_key: string }>(
        `select distinct logical_key from novelties where tariff_annex_import_id = $1 and code = 'CSV_002'
          and logical_key like '%|' || $2 || '|%'`,
        [firstBatch.id, productX.toUpperCase()],
      )
    ).rows[0]!.logical_key;
    const yKey = (
      await database.query<{ logical_key: string }>(
        `select distinct logical_key from novelties where tariff_annex_import_id = $1 and code = 'CSV_002'
          and logical_key like '%|' || $2 || '|%'`,
        [firstBatch.id, productY.toUpperCase()],
      )
    ).rows[0]!.logical_key;
    // Una sola fila duplicada por producto = un intento activo.
    expect(await itemCount(xKey)).toBe(1);
    expect((await noveltiesByKey(xKey)).filter((row) => row.active)).toHaveLength(1);

    // La carga corregida solo cierra la novedad del producto X (PRODUCT_EXISTING).
    await waitForTariffImport(
      (await uploadTariffImport([[productX, '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS']])).id,
    );
    expect((await noveltiesByKey(xKey)).filter((row) => row.active)).toHaveLength(0);
    expect((await noveltiesByKey(yKey)).filter((row) => row.active)).toHaveLength(1);
    const technical = await database.query<{ active: boolean }>(
      `select active from novelties where tariff_annex_import_id = $1 and code = 'CSV_005'`,
      [firstBatch.id],
    );
    expect(technical.rows.map((row) => row.active)).toEqual([true]);
    const resolutionAudit = await database.query<{ total: number }>(
      `select count(*)::int as total from audit_events
        where action = 'NOVELTY_RESOLVED' and after->>'reason' = 'TARIFF_PRODUCT_AVAILABLE:PRODUCT_EXISTING'`,
    );
    expect(Number(resolutionAudit.rows[0]?.total ?? 0)).toBeGreaterThan(0);
  });

  it('la bandeja API y el XLSX exponen solo causales activas con attemptCount historico', async () => {
    const productZ = `NOVZ-${randomUUID()}`;
    const batchId = (
      await uploadTariffImport([
        [productZ, '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
        [productZ, '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
      ])
    ).id;
    await waitForTariffImport(batchId);
    const activeNovelty = (
      await database.query<{ id: string; logical_key: string }>(
        `select id, logical_key from novelties where tariff_annex_import_id = $1 and code = 'CSV_002' and active = true`,
        [batchId],
      )
    ).rows[0]!;
    const listed = await fetch(`${apiUrl}/api/v1/novelties?code=CSV_002`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(listed.status).toBe(200);
    const value = (await listed.json()) as {
      items: Array<{ id: string; attemptNumber: number; attemptCount: number }>;
    };
    const ours = value.items.find((novelty) => novelty.id === activeNovelty.id);
    expect(ours).toBeDefined();
    expect(ours!.attemptNumber).toBe(1);
    expect(ours!.attemptCount).toBe(1);
    const xlsx = await fetch(`${apiUrl}/api/v1/novelties/xlsx?code=CSV_002`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(xlsx.status).toBe(200);
    const workbook = XLSX.read(await xlsx.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets.Datos!, {
      raw: false,
    });
    const batchRows = rows.filter((row) => row['ID_LOTE'] === batchId);
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0]!['ESTADO_PROCESAMIENTO']).toBe('PENDIENTE');
  });
});
