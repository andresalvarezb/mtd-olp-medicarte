import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createDatabase } from '../../packages/database/src/index.js';
import { TariffAnnexRepository } from '../../apps/api/src/tariff-annex/tariff-annex.repository';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const database = createDatabase(databaseUrl);

type Foundation = {
  mtdOrganizationId: string;
  otherOrganizationId: string;
  userId: string;
};

let foundation: Foundation;

const createdImportIds: string[] = [];
const createdProductCodes: string[] = [];

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'AT');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

const headers = [
  'CODIGO_PRODUCTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA',
  'DESCRIPCION_COMERCIAL',
  'LABORATORIO',
  'TIPO_INCLUSION_MEDICAMENTO',
];

async function createImport(input: {
  organizationId: string;
  userId: string;
  content: Buffer;
}): Promise<string> {
  const id = randomUUID();
  const correlationId = randomUUID();
  const sha256 = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);

  await database.pool.query(
    `insert into tariff_annex_imports (
       id,
       organization_id,
       created_by,
       original_filename,
       mime_type,
       size_bytes,
       sha256,
       status,
       correlation_id,
       idempotency_key
     )
     values ($1,$2,$3,$4,$5,$6,$7,'UPLOADED',$8,$9)`,
    [
      id,
      input.organizationId,
      input.userId,
      `gate-step1-${id}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      input.content.length,
      sha256,
      correlationId,
      `gate-step1-${id}`,
    ],
  );

  await database.pool.query(
    `insert into tariff_annex_import_source_files (
       import_id,
       original_filename,
       mime_type,
       size_bytes,
       sha256,
       content
     )
     values ($1,$2,$3,$4,$5,$6)`,
    [
      id,
      `gate-step1-${id}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      input.content.length,
      sha256,
      input.content,
    ],
  );

  createdImportIds.push(id);

  return id;
}

async function catalogFingerprint(code: string): Promise<string> {
  const result = await database.pool.query(
    `select
       id::text,
       codigo_producto,
       tarifa_unidad,
       tarifa_unidad_canonical::text,
       numero_expediente_invima,
       consecutivo_invima_presentacion,
       descripcion_generica,
       descripcion_comercial,
       laboratorio,
       tipo_inclusion,
       active,
       version,
       created_by::text,
       updated_by::text,
       created_at::text,
       updated_at::text
     from tariff_annex_products
     where codigo_producto = $1
     order by id`,
    [code],
  );

  return JSON.stringify(result.rows);
}

describe.sequential('STEP1 tariff PREPARE gate', () => {
  beforeAll(async () => {
    const organizations = await database.pool.query<{
      id: string;
      code: string;
    }>(
      `select id, code
       from organizations
       where code in ('MTD','MEDICARTE')
       order by case code when 'MTD' then 0 else 1 end`,
    );

    const mtd = organizations.rows.find((row) => row.code === 'MTD');
    const other =
      organizations.rows.find((row) => row.code === 'MEDICARTE') ??
      organizations.rows.find((row) => row.code !== 'MTD');

    if (!mtd) throw new Error('MTD organization fixture not found');
    if (!other) throw new Error('Secondary organization fixture not found');

    const userResult = await database.pool.query<{ id: string }>(
      `select id
       from users
       where active = true
       order by created_at
       limit 1`,
    );

    const user = userResult.rows[0];
    if (!user) throw new Error('Active user fixture not found');

    foundation = {
      mtdOrganizationId: mtd.id,
      otherOrganizationId: other.id,
      userId: user.id,
    };
  });

  afterAll(async () => {
    if (createdImportIds.length > 0) {
      await database.pool.query(
        `delete from tariff_annex_imports
         where id = any($1::uuid[])`,
        [createdImportIds],
      );
    }

    if (createdProductCodes.length > 0) {
      await database.pool.query(
        `delete from tariff_annex_products
         where codigo_producto = any($1::text[])`,
        [createdProductCodes],
      );
    }

    await database.pool.end();
  });

  it('PREPARE producto nuevo genera staging sin crear producto activo', async () => {
    const code = `STEP1-NEW-${randomUUID().slice(0, 8).toUpperCase()}`;
    createdProductCodes.push(code);

    const content = workbookBuffer([
      headers,
      [code, '12,50', 'EXP-NEW', 'PRES-NEW', 'Gen New', 'Com New', 'Lab New', 'PBS'],
    ]);

    const importId = await createImport({
      organizationId: foundation.mtdOrganizationId,
      userId: foundation.userId,
      content,
    });

    const repository = new TariffAnnexRepository(database);

    const before = await catalogFingerprint(code);

    const result = await repository.prepareImport({
      importId,
      actor: {
        userId: foundation.userId,
        organizationId: foundation.mtdOrganizationId,
        correlationId: randomUUID(),
      },
    });

    const after = await catalogFingerprint(code);

    expect(result.outcome).toBe('prepared');

    if (result.outcome !== 'prepared') {
      throw new Error(`Unexpected outcome: ${result.outcome}`);
    }

    expect(result.preview).toMatchObject({
      total: 1,
      unchanged: 0,
      changed: 1,
      anomalous: 0,
      rejected: 0,
    });

    expect(result.preview.rows[0]).toMatchObject({
      codigoProducto: code,
      state: 'CHANGED',
      action: 'NEW',
    });

    expect(after).toBe(before);
    expect(after).toBe('[]');

    const batch = await database.pool.query<{
      status: string;
      preview_total: number;
      preview_changed: number;
      preview_unchanged: number;
      preview_anomalous: number;
      preview_rejected: number;
    }>(
      `select
         status,
         preview_total,
         preview_changed,
         preview_unchanged,
         preview_anomalous,
         preview_rejected
       from tariff_annex_imports
       where id = $1`,
      [importId],
    );

    expect(batch.rows[0]).toMatchObject({
      status: 'PREPARED',
      preview_total: 1,
      preview_changed: 1,
      preview_unchanged: 0,
      preview_anomalous: 0,
      preview_rejected: 0,
    });

    const rows = await database.pool.query<{
      result_code: string;
      codigo_producto: string;
      product_id: string | null;
      tarifa_unidad_raw: string | null;
      tarifa_unidad_canonical: string | null;
    }>(
      `select
         result_code,
         codigo_producto,
         product_id,
         tarifa_unidad_raw,
         tarifa_unidad_canonical::text
       from tariff_annex_import_rows
       where import_id = $1
       order by row_number`,
      [importId],
    );

    expect(rows.rows).toHaveLength(1);

    expect(rows.rows[0]).toMatchObject({
      result_code: 'PREVIEW_NEW',
      codigo_producto: code,
      product_id: null,
      tarifa_unidad_raw: '12,50',
      tarifa_unidad_canonical: '12.5000',
    });
  });

  it('PREPARE existente idéntico queda UNCHANGED sin tocar version/updated_at', async () => {
    const code = `STEP1-SAME-${randomUUID().slice(0, 8).toUpperCase()}`;
    createdProductCodes.push(code);

    await database.pool.query(
      `insert into tariff_annex_products (
         codigo_producto,
         tarifa_unidad,
         tarifa_unidad_canonical,
         numero_expediente_invima,
         consecutivo_invima_presentacion,
         descripcion_generica,
         descripcion_comercial,
         laboratorio,
         tipo_inclusion,
         active,
         organization_id,
         created_by,
         updated_by
       )
       values (
         $1,
         '10,25',
         10.2500,
         'EXP-1',
         'PRES-1',
         'Producto genérico',
         'Producto comercial',
         'Laboratorio',
         'PBS',
         true,
         $2,
         $3,
         $3
       )`,
      [code, foundation.mtdOrganizationId, foundation.userId],
    );

    const content = workbookBuffer([
      headers,
      [
        code.toLowerCase(),
        '10.2500',
        'EXP-1',
        'PRES-1',
        'Producto genérico',
        'Producto comercial',
        'Laboratorio',
        'PBS',
      ],
    ]);

    const importId = await createImport({
      organizationId: foundation.mtdOrganizationId,
      userId: foundation.userId,
      content,
    });

    const repository = new TariffAnnexRepository(database);

    const before = await catalogFingerprint(code);

    const result = await repository.prepareImport({
      importId,
      actor: {
        userId: foundation.userId,
        organizationId: foundation.mtdOrganizationId,
        correlationId: randomUUID(),
      },
    });

    const after = await catalogFingerprint(code);

    expect(result.outcome).toBe('prepared');

    if (result.outcome !== 'prepared') {
      throw new Error(`Unexpected outcome: ${result.outcome}`);
    }

    expect(result.preview).toMatchObject({
      total: 1,
      unchanged: 1,
      changed: 0,
      anomalous: 0,
      rejected: 0,
    });

    expect(after).toBe(before);

    const row = await database.pool.query<{
      result_code: string;
    }>(
      `select result_code
       from tariff_annex_import_rows
       where import_id = $1`,
      [importId],
    );

    expect(row.rows[0]?.result_code).toBe('PREVIEW_UNCHANGED');
  });

  it('PREPARE cambiado conserva valor activo anterior', async () => {
    const code = `STEP1-CHANGE-${randomUUID().slice(0, 8).toUpperCase()}`;
    createdProductCodes.push(code);

    await database.pool.query(
      `insert into tariff_annex_products (
         codigo_producto,
         tarifa_unidad,
         tarifa_unidad_canonical,
         numero_expediente_invima,
         consecutivo_invima_presentacion,
         descripcion_generica,
         descripcion_comercial,
         laboratorio,
         tipo_inclusion,
         active,
         organization_id,
         created_by,
         updated_by
       )
       values (
         $1,
         '10.25',
         10.2500,
         'EXP-1',
         'PRES-1',
         'Gen',
         'Com',
         'Lab',
         'PBS',
         true,
         $2,
         $3,
         $3
       )`,
      [code, foundation.mtdOrganizationId, foundation.userId],
    );

    const content = workbookBuffer([
      headers,
      [code, '12,50', 'EXP-1', 'PRES-1', 'Gen', 'Com', 'Lab', 'PBS'],
    ]);

    const importId = await createImport({
      organizationId: foundation.mtdOrganizationId,
      userId: foundation.userId,
      content,
    });

    const repository = new TariffAnnexRepository(database);

    const before = await catalogFingerprint(code);

    const result = await repository.prepareImport({
      importId,
      actor: {
        userId: foundation.userId,
        organizationId: foundation.mtdOrganizationId,
        correlationId: randomUUID(),
      },
    });

    const after = await catalogFingerprint(code);

    expect(result.outcome).toBe('prepared');

    if (result.outcome !== 'prepared') {
      throw new Error(`Unexpected outcome: ${result.outcome}`);
    }

    expect(result.preview.changed).toBe(1);
    expect(result.preview.rows[0]).toMatchObject({
      state: 'CHANGED',
      action: 'UPDATE',
    });

    expect(after).toBe(before);

    const product = await database.pool.query<{
      tarifa_unidad_canonical: string | null;
      version: number;
    }>(
      `select tarifa_unidad_canonical::text, version
       from tariff_annex_products
       where codigo_producto = $1`,
      [code],
    );

    expect(product.rows[0]?.tarifa_unidad_canonical).toBe('10.2500');
    expect(product.rows[0]?.version).toBe(1);
  });

  it('PREPARE repetido es idempotente y no duplica staging', async () => {
    const code = `STEP1-IDEM-${randomUUID().slice(0, 8).toUpperCase()}`;
    createdProductCodes.push(code);

    const content = workbookBuffer([
      headers,
      [code, '33.00', 'EXP-IDEM', 'PRES-IDEM', 'Gen', 'Com', 'Lab', 'PBS'],
    ]);

    const importId = await createImport({
      organizationId: foundation.mtdOrganizationId,
      userId: foundation.userId,
      content,
    });

    const repository = new TariffAnnexRepository(database);

    const actor = {
      userId: foundation.userId,
      organizationId: foundation.mtdOrganizationId,
      correlationId: randomUUID(),
    };

    const first = await repository.prepareImport({
      importId,
      actor,
    });

    const rowsAfterFirst = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from tariff_annex_import_rows
       where import_id = $1`,
      [importId],
    );

    const second = await repository.prepareImport({
      importId,
      actor,
    });

    const rowsAfterSecond = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from tariff_annex_import_rows
       where import_id = $1`,
      [importId],
    );

    expect(first.outcome).toBe('prepared');
    expect(second.outcome).toBe('prepared');

    if (first.outcome !== 'prepared' || second.outcome !== 'prepared') {
      throw new Error('Expected prepared outcomes');
    }

    expect(second.preview).toEqual(first.preview);
    expect(rowsAfterFirst.rows[0]?.count).toBe('1');
    expect(rowsAfterSecond.rows[0]?.count).toBe('1');

    const products = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from tariff_annex_products
       where codigo_producto = $1`,
      [code],
    );

    expect(products.rows[0]?.count).toBe('0');
  });

  it('PREPARE con organización distinta no encuentra el import ni muta datos', async () => {
    const code = `STEP1-ORG-${randomUUID().slice(0, 8).toUpperCase()}`;
    createdProductCodes.push(code);

    const content = workbookBuffer([
      headers,
      [code, '44.00', 'EXP-ORG', 'PRES-ORG', 'Gen', 'Com', 'Lab', 'PBS'],
    ]);

    const importId = await createImport({
      organizationId: foundation.mtdOrganizationId,
      userId: foundation.userId,
      content,
    });

    const repository = new TariffAnnexRepository(database);

    const result = await repository.prepareImport({
      importId,
      actor: {
        userId: foundation.userId,
        organizationId: foundation.otherOrganizationId,
        correlationId: randomUUID(),
      },
    });

    expect(result).toEqual({
      outcome: 'not_found',
    });

    const batch = await database.pool.query<{
      status: string;
    }>(
      `select status
       from tariff_annex_imports
       where id = $1`,
      [importId],
    );

    expect(batch.rows[0]?.status).toBe('UPLOADED');

    const staging = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from tariff_annex_import_rows
       where import_id = $1`,
      [importId],
    );

    expect(staging.rows[0]?.count).toBe('0');

    const products = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
       from tariff_annex_products
       where codigo_producto = $1`,
      [code],
    );

    expect(products.rows[0]?.count).toBe('0');
  });
});
