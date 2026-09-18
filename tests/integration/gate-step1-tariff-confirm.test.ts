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

const matureHeaders = [
  'CODIGO_PRODUCTO',
  'TARIFA_UNIDAD',
  'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION',
  'DESCRIPCION_GENERICA_MEDICAMENTO',
  'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  'LABORATORIO_MEDICAMENTO',
  'TIPO_INCLUSION_MEDICAMENTO',
];

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);

  XLSX.utils.book_append_sheet(workbook, sheet, 'AT');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

async function createImport(content: Buffer): Promise<string> {
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
      foundation.mtdOrganizationId,
      foundation.userId,
      `gate-confirm-${id}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content.length,
      sha256,
      correlationId,
      `gate-confirm-${id}`,
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
      `gate-confirm-${id}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content.length,
      sha256,
      content,
    ],
  );

  return id;
}

async function insertProduct(input: {
  code: string;
  tariff: string;
  generic?: string;
  commercial?: string;
  laboratory?: string;
}): Promise<string> {
  const result = await database.pool.query<{ id: string }>(
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
       $2::varchar,
       $3::numeric,
       'EXP-1',
       'PRES-1',
       $4,
       $5,
       $6,
       'PBS',
       true,
       $7,
       $8,
       $8
     )
     returning id`,
    [
      input.code,
      input.tariff,
      input.tariff.replace(',', '.'),
      input.generic ?? 'Gen',
      input.commercial ?? 'Com',
      input.laboratory ?? 'Lab',
      foundation.mtdOrganizationId,
      foundation.userId,
    ],
  );

  const id = result.rows[0]?.id;

  if (!id) throw new Error('Product insert returned no id');

  return id;
}

function actor(organizationId = foundation.mtdOrganizationId) {
  return {
    userId: foundation.userId,
    organizationId,
    correlationId: randomUUID(),
  };
}

async function prepare(repository: TariffAnnexRepository, importId: string): Promise<void> {
  const result = await repository.prepareImport({
    importId,
    actor: actor(),
  });

  expect(result.outcome).toBe('prepared');
}

async function revisionCount(productId: string): Promise<number> {
  const result = await database.pool.query<{ count: number }>(
    `select count(*)::int as count
     from tariff_product_revisions
     where product_id = $1`,
    [productId],
  );

  return result.rows[0]?.count ?? 0;
}

describe.sequential('STEP1 tariff CONFIRM gate', () => {
  beforeAll(async () => {
    const organizations = await database.pool.query<{
      id: string;
      code: string;
    }>(
      `select id, code
       from organizations
       where code in ('MTD', 'MEDICARTE')
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
    // tariff_product_revisions es append-only por diseño.
    // Esta suite utiliza códigos aleatorios sobre una DB dedicada de integración,
    // por lo que no elimina historia para limpiar fixtures.
    await database.pool.end();
  });

  it('CONFIRM crea producto nuevo y revision 1 con provenance', async () => {
    const code = `CONF-NEW-${randomUUID().slice(0, 8).toUpperCase()}`;

    const content = workbookBuffer([
      matureHeaders,
      [code, '12,50', 'EXP-N', 'PRES-N', 'Gen New', 'Com New', 'Lab New', 'PBS'],
    ]);

    const importId = await createImport(content);

    const repository = new TariffAnnexRepository(database);

    await prepare(repository, importId);

    const before = await database.pool.query<{ count: number }>(
      `select count(*)::int as count
       from tariff_annex_products
       where codigo_producto = $1`,
      [code],
    );

    expect(before.rows[0]?.count).toBe(0);

    const confirmed = await repository.confirmImport({
      importId,
      actor: actor(),
    });

    expect(confirmed).toMatchObject({
      outcome: 'completed',
      created: 1,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });

    const productResult = await database.pool.query<{
      id: string;
      tarifa_unidad_canonical: string;
      version: number;
      active: boolean;
    }>(
      `select
         id,
         tarifa_unidad_canonical::text,
         version,
         active
       from tariff_annex_products
       where codigo_producto = $1`,
      [code],
    );

    const product = productResult.rows[0];

    expect(product).toMatchObject({
      tarifa_unidad_canonical: '12.5000',
      version: 1,
      active: true,
    });

    if (!product) throw new Error('Confirmed product not found');

    const revisions = await database.pool.query<{
      revision: number;
      import_id: string | null;
      import_row_id: string | null;
      tarifa_unidad_canonical: string | null;
      provenance: string;
    }>(
      `select
         revision,
         import_id,
         import_row_id,
         tarifa_unidad_canonical::text,
         provenance
       from tariff_product_revisions
       where product_id = $1
       order by revision`,
      [product.id],
    );

    expect(revisions.rows).toHaveLength(1);

    expect(revisions.rows[0]).toMatchObject({
      revision: 1,
      import_id: importId,
      tarifa_unidad_canonical: '12.5000',
      provenance: 'CONFIRM:tariff_annex_import:new_product',
    });

    expect(revisions.rows[0]?.import_row_id).not.toBeNull();

    const batch = await database.pool.query<{
      status: string;
      confirmed_by: string | null;
      confirmed_at: Date | null;
    }>(
      `select status, confirmed_by, confirmed_at
       from tariff_annex_imports
       where id = $1`,
      [importId],
    );

    expect(batch.rows[0]?.status).toBe('COMPLETED');
    expect(batch.rows[0]?.confirmed_by).toBe(foundation.userId);
    expect(batch.rows[0]?.confirmed_at).not.toBeNull();
  });

  it('CONFIRM de producto idéntico es NO_OP real', async () => {
    const code = `CONF-SAME-${randomUUID().slice(0, 8).toUpperCase()}`;

    const productId = await insertProduct({
      code,
      tariff: '10.2500',
      generic: 'Gen Same',
      commercial: 'Com Same',
      laboratory: 'Lab Same',
    });

    const before = await database.pool.query<{
      version: number;
      updated_at: Date;
    }>(
      `select version, updated_at
       from tariff_annex_products
       where id = $1`,
      [productId],
    );

    expect(await revisionCount(productId)).toBe(0);

    const content = workbookBuffer([
      matureHeaders,
      [code.toLowerCase(), '10,25', 'EXP-1', 'PRES-1', 'Gen Same', 'Com Same', 'Lab Same', 'PBS'],
    ]);

    const importId = await createImport(content);

    const repository = new TariffAnnexRepository(database);

    await prepare(repository, importId);

    const confirmed = await repository.confirmImport({
      importId,
      actor: actor(),
    });

    expect(confirmed).toMatchObject({
      outcome: 'completed',
      created: 0,
      updated: 0,
      unchanged: 1,
    });

    const after = await database.pool.query<{
      version: number;
      updated_at: Date;
    }>(
      `select version, updated_at
       from tariff_annex_products
       where id = $1`,
      [productId],
    );

    expect(after.rows[0]?.version).toBe(before.rows[0]?.version);

    expect(after.rows[0]?.updated_at.toISOString()).toBe(before.rows[0]?.updated_at.toISOString());

    expect(await revisionCount(productId)).toBe(0);
  });

  it('CONFIRM cambiado preserva baseline y crea nueva revision', async () => {
    const code = `CONF-CHANGE-${randomUUID().slice(0, 8).toUpperCase()}`;

    const productId = await insertProduct({
      code,
      tariff: '10.2500',
    });

    const content = workbookBuffer([
      matureHeaders,
      [code, '12,50', 'EXP-1', 'PRES-1', 'Gen', 'Com', 'Lab', 'PBS'],
    ]);

    const importId = await createImport(content);

    const repository = new TariffAnnexRepository(database);

    await prepare(repository, importId);

    const preparedProduct = await database.pool.query<{
      tarifa_unidad_canonical: string;
      version: number;
    }>(
      `select tarifa_unidad_canonical::text, version
       from tariff_annex_products
       where id = $1`,
      [productId],
    );

    expect(preparedProduct.rows[0]).toMatchObject({
      tarifa_unidad_canonical: '10.2500',
      version: 1,
    });

    const confirmed = await repository.confirmImport({
      importId,
      actor: actor(),
    });

    expect(confirmed).toMatchObject({
      outcome: 'completed',
      created: 0,
      updated: 1,
      unchanged: 0,
    });

    const product = await database.pool.query<{
      tarifa_unidad_canonical: string;
      version: number;
    }>(
      `select tarifa_unidad_canonical::text, version
       from tariff_annex_products
       where id = $1`,
      [productId],
    );

    expect(product.rows[0]).toMatchObject({
      tarifa_unidad_canonical: '12.5000',
      version: 2,
    });

    const revisions = await database.pool.query<{
      revision: number;
      import_id: string | null;
      import_row_id: string | null;
      tarifa_unidad_canonical: string | null;
      provenance: string;
    }>(
      `select
         revision,
         import_id,
         import_row_id,
         tarifa_unidad_canonical::text,
         provenance
       from tariff_product_revisions
       where product_id = $1
       order by revision`,
      [productId],
    );

    expect(revisions.rows).toHaveLength(2);

    expect(revisions.rows[0]).toMatchObject({
      revision: 1,
      import_id: null,
      import_row_id: null,
      tarifa_unidad_canonical: '10.2500',
      provenance: 'CONFIRM_BASELINE:captured_before_first_managed_update',
    });

    expect(revisions.rows[1]).toMatchObject({
      revision: 2,
      import_id: importId,
      tarifa_unidad_canonical: '12.5000',
      provenance: 'CONFIRM:tariff_annex_import:product_update',
    });

    expect(revisions.rows[1]?.import_row_id).not.toBeNull();
  });

  it('ANOMALY exige override y solo aplica con reason valido', async () => {
    const code = `CONF-ANOM-${randomUUID().slice(0, 8).toUpperCase()}`;

    const productId = await insertProduct({
      code,
      tariff: '10.2500',
    });

    const content = workbookBuffer([
      matureHeaders,
      [code, '10250', 'EXP-1', 'PRES-1', 'Gen', 'Com', 'Lab', 'PBS'],
    ]);

    const importId = await createImport(content);

    const repository = new TariffAnnexRepository(database);

    const prepared = await repository.prepareImport({
      importId,
      actor: actor(),
    });

    expect(prepared.outcome).toBe('prepared');

    if (prepared.outcome !== 'prepared') {
      throw new Error('Expected PREPARED');
    }

    expect(prepared.preview.anomalous).toBe(1);

    const blocked = await repository.confirmImport({
      importId,
      actor: actor(),
    });

    expect(blocked).toEqual({
      outcome: 'override_required',
    });

    const blockedState = await database.pool.query<{
      status: string;
      tarifa_unidad_canonical: string;
    }>(
      `select
         i.status,
         p.tarifa_unidad_canonical::text
       from tariff_annex_imports i
       cross join tariff_annex_products p
       where i.id = $1
         and p.id = $2`,
      [importId, productId],
    );

    expect(blockedState.rows[0]).toMatchObject({
      status: 'PREPARED',
      tarifa_unidad_canonical: '10.2500',
    });

    expect(await revisionCount(productId)).toBe(0);

    const confirmed = await repository.confirmImport({
      importId,
      overrideReason: 'Validación manual de cambio de escala',
      actor: actor(),
    });

    expect(confirmed).toMatchObject({
      outcome: 'completed',
      updated: 1,
    });

    const applied = await database.pool.query<{
      tarifa_unidad_canonical: string;
      status: string;
      override_reason: string | null;
    }>(
      `select
         p.tarifa_unidad_canonical::text,
         i.status,
         i.override_reason
       from tariff_annex_imports i
       join tariff_annex_products p on p.id = $2
       where i.id = $1`,
      [importId, productId],
    );

    expect(applied.rows[0]).toMatchObject({
      tarifa_unidad_canonical: '10250.0000',
      status: 'COMPLETED',
      override_reason: 'Validación manual de cambio de escala',
    });

    expect(await revisionCount(productId)).toBe(2);
  });

  it('CONFIRM repetido no reaplica producto ni duplica revisiones', async () => {
    const code = `CONF-IDEM-${randomUUID().slice(0, 8).toUpperCase()}`;

    const content = workbookBuffer([
      matureHeaders,
      [code, '44.00', 'EXP-I', 'PRES-I', 'Gen Idem', 'Com Idem', 'Lab Idem', 'PBS'],
    ]);

    const importId = await createImport(content);

    const repository = new TariffAnnexRepository(database);

    await prepare(repository, importId);

    const first = await repository.confirmImport({
      importId,
      actor: actor(),
    });

    expect(first.outcome).toBe('completed');

    const productResult = await database.pool.query<{
      id: string;
      version: number;
      updated_at: Date;
      tarifa_unidad_canonical: string;
    }>(
      `select
         id,
         version,
         updated_at,
         tarifa_unidad_canonical::text
       from tariff_annex_products
       where codigo_producto = $1`,
      [code],
    );

    const beforeSecond = productResult.rows[0];

    if (!beforeSecond) throw new Error('Product not found after first confirm');

    const revisionsBefore = await revisionCount(beforeSecond.id);

    const second = await repository.confirmImport({
      importId,
      actor: actor(),
    });

    expect(second.outcome).toBe('completed');

    const afterSecondResult = await database.pool.query<{
      version: number;
      updated_at: Date;
      tarifa_unidad_canonical: string;
    }>(
      `select
         version,
         updated_at,
         tarifa_unidad_canonical::text
       from tariff_annex_products
       where id = $1`,
      [beforeSecond.id],
    );

    const afterSecond = afterSecondResult.rows[0];

    expect(afterSecond?.version).toBe(beforeSecond.version);

    expect(afterSecond?.updated_at.toISOString()).toBe(beforeSecond.updated_at.toISOString());

    expect(afterSecond?.tarifa_unidad_canonical).toBe(beforeSecond.tarifa_unidad_canonical);

    expect(await revisionCount(beforeSecond.id)).toBe(revisionsBefore);
    expect(revisionsBefore).toBe(1);
  });

  it('CONFIRM cross-org devuelve not_found y no materializa', async () => {
    const code = `CONF-ORG-${randomUUID().slice(0, 8).toUpperCase()}`;

    const content = workbookBuffer([
      matureHeaders,
      [code, '55.00', 'EXP-O', 'PRES-O', 'Gen Org', 'Com Org', 'Lab Org', 'PBS'],
    ]);

    const importId = await createImport(content);

    const repository = new TariffAnnexRepository(database);

    await prepare(repository, importId);

    const result = await repository.confirmImport({
      importId,
      actor: actor(foundation.otherOrganizationId),
    });

    expect(result).toEqual({
      outcome: 'not_found',
    });

    const batch = await database.pool.query<{ status: string }>(
      `select status
       from tariff_annex_imports
       where id = $1`,
      [importId],
    );

    expect(batch.rows[0]?.status).toBe('PREPARED');

    const products = await database.pool.query<{ count: number }>(
      `select count(*)::int as count
       from tariff_annex_products
       where codigo_producto = $1`,
      [code],
    );

    expect(products.rows[0]?.count).toBe(0);
  });
});
