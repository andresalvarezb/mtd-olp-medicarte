import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGANIZATION_IDS, adminLogin, ensureOperatorTokens } from './helpers/auth';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization_test_integration';

const database = new Client({
  connectionString: databaseUrl,
});

const mtdOrganizationId = ORGANIZATION_IDS.MTD;

let adminToken: string;
let olpToken: string;

let importId: string;
let commercialCode: string;

function buildTariffFile(input: { code: string; tariff: string }): Buffer {
  const workbook = XLSX.utils.book_new();

  const worksheet = XLSX.utils.aoa_to_sheet([
    [
      'CODIGO_PRODUCTO',
      'TARIFA_UNIDAD',
      'NUMERO_EXPEDIENTE_INVIMA',
      'CONSECUTIVO_INVIMA_PRESENTACION',
      'DESCRIPCION_GENERICA_MEDICAMENTO',
      'DESCRIPCION_COMERCIAL_MEDICAMENTO',
      'LABORATORIO_MEDICAMENTO',
      'TIPO_INCLUSION_MEDICAMENTO',
    ],
    [
      input.code,
      input.tariff,
      'EXP-HTTP-1',
      'PRES-HTTP-1',
      'GENERICO HTTP',
      'COMERCIAL HTTP',
      'LAB HTTP',
      'PBS',
    ],
  ]);

  XLSX.utils.book_append_sheet(workbook, worksheet, 'ANEXO');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

async function uploadTariff(
  token: string,
  organizationId: string,
  file: Buffer,
): Promise<Response> {
  const form = new FormData();

  form.append(
    'file',
    new Blob([file], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'anexo-http.xlsx',
  );

  return fetch(`${apiUrl}/api/v1/admin/tariff-annex/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
    },
    body: form,
  });
}

async function apiJson(
  method: string,
  path: string,
  token: string,
  organizationId: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${apiUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      ...(body === undefined
        ? {}
        : {
            'content-type': 'application/json',
          }),
    },
    ...(body === undefined
      ? {}
      : {
          body: JSON.stringify(body),
        }),
  });
}

beforeAll(async () => {
  await database.connect();

  adminToken = await adminLogin();

  ({ olpToken } = await ensureOperatorTokens());

  commercialCode = `HTTP-${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
});

afterAll(async () => {
  await database.end();
});

describe('STEP1 tariff HTTP gate', () => {
  it('rechaza importación AT desde OLP', async () => {
    const file = buildTariffFile({
      code: `${commercialCode}-OLP`,
      tariff: '12.50',
    });

    const response = await uploadTariff(olpToken, ORGANIZATION_IDS.OLP, file);

    expect(response.status).toBe(403);

    const payload = (await response.json()) as {
      code?: string;
    };

    expect(payload.code).toBe('PERMISSION_DENIED');
  });

  it('UPLOAD crea lote UPLOADED sin materializar producto', async () => {
    const file = buildTariffFile({
      code: commercialCode,
      tariff: '12,50',
    });

    const response = await uploadTariff(adminToken, mtdOrganizationId, file);

    expect(response.status).toBe(202);

    const payload = (await response.json()) as {
      id: string;
      status: string;
      previewTotal: number;
    };

    importId = payload.id;

    expect(payload.status).toBe('UPLOADED');

    expect(payload.previewTotal).toBe(0);

    const product = await database.query<{
      count: number;
    }>(
      `
              select count(*)::int as count
              from tariff_annex_products
              where codigo_producto = $1
            `,
      [commercialCode],
    );

    expect(product.rows[0]?.count).toBe(0);
  });

  it('PREPARE genera preview persistido sin modificar catálogo activo', async () => {
    const response = await apiJson(
      'POST',
      `/admin/tariff-annex/imports/${importId}/prepare`,
      adminToken,
      mtdOrganizationId,
    );

    expect(response.status).toBe(200);

    const prepare = (await response.json()) as {
      outcome: string;
      preview: {
        total: number;
        changed: number;
        rows: Array<{
          codigoProducto: string;
          action: string;
          state: string;
        }>;
      };
    };

    expect(prepare.outcome).toBe('prepared');

    expect(prepare.preview.total).toBe(1);

    expect(prepare.preview.changed).toBe(1);

    expect(prepare.preview.rows[0]).toMatchObject({
      codigoProducto: commercialCode,
      action: 'NEW',
      state: 'CHANGED',
    });

    const detail = await apiJson(
      'GET',
      `/admin/tariff-annex/imports/${importId}`,
      adminToken,
      mtdOrganizationId,
    );

    expect(detail.status).toBe(200);

    const batch = (await detail.json()) as {
      status: string;
      previewTotal: number;
      previewChanged: number;
    };

    expect(batch.status).toBe('PREPARED');

    expect(batch.previewTotal).toBe(1);

    expect(batch.previewChanged).toBe(1);

    const product = await database.query<{
      count: number;
    }>(
      `
              select count(*)::int as count
              from tariff_annex_products
              where codigo_producto = $1
            `,
      [commercialCode],
    );

    expect(product.rows[0]?.count).toBe(0);
  });

  it('CONFIRM completa importación y materializa producto + revisión', async () => {
    const response = await apiJson(
      'POST',
      `/admin/tariff-annex/imports/${importId}/confirm`,
      adminToken,
      mtdOrganizationId,
      {},
    );

    expect(response.status).toBe(200);

    const confirm = (await response.json()) as {
      outcome: string;
      created: number;
      updated: number;
      unchanged: number;
      rejected: number;
    };

    expect(confirm).toMatchObject({
      outcome: 'completed',
      created: 1,
      updated: 0,
      unchanged: 0,
      rejected: 0,
    });

    const detail = await apiJson(
      'GET',
      `/admin/tariff-annex/imports/${importId}`,
      adminToken,
      mtdOrganizationId,
    );

    expect(detail.status).toBe(200);

    const batch = (await detail.json()) as {
      status: string;
      confirmedAt: string | null;
      completedAt: string | null;
    };

    expect(batch.status).toBe('COMPLETED');

    expect(batch.confirmedAt).not.toBeNull();

    expect(batch.completedAt).not.toBeNull();

    const product = await database.query<{
      id: string;
      tarifa_unidad: string;
      tarifa_unidad_canonical: string;
      descripcion_generica: string | null;
      descripcion_comercial: string | null;
      laboratorio: string | null;
      tipo_inclusion: string | null;
      version: number;
      active: boolean;
    }>(
      `
              select
                id,
                tarifa_unidad,
                tarifa_unidad_canonical::text,
                descripcion_generica,
                descripcion_comercial,
                laboratorio,
                tipo_inclusion,
                version,
                active
              from tariff_annex_products
              where codigo_producto = $1
            `,
      [commercialCode],
    );

    expect(product.rows).toHaveLength(1);

    const active = product.rows[0]!;

    expect(active.tarifa_unidad_canonical).toBe('12.5000');

    expect(active.descripcion_generica).toBe('GENERICO HTTP');

    expect(active.descripcion_comercial).toBe('COMERCIAL HTTP');

    expect(active.laboratorio).toBe('LAB HTTP');

    expect(active.tipo_inclusion).toBe('PBS');

    expect(active.version).toBe(1);
    expect(active.active).toBe(true);

    const revisions = await database.query<{
      revision: number;
      import_id: string | null;
      import_row_id: string | null;
      tarifa_unidad_canonical: string;
      descripcion_generica: string | null;
      descripcion_comercial: string | null;
      laboratorio: string | null;
      provenance: string;
    }>(
      `
              select
                revision,
                import_id,
                import_row_id,
                tarifa_unidad_canonical::text,
                commercial_snapshot->>'descripcionGenerica'
                  as descripcion_generica,
                commercial_snapshot->>'descripcionComercial'
                  as descripcion_comercial,
                commercial_snapshot->>'laboratorio'
                  as laboratorio,
                provenance
              from tariff_product_revisions
              where product_id = $1
              order by revision
            `,
      [active.id],
    );

    expect(revisions.rows).toHaveLength(1);

    expect(revisions.rows[0]).toMatchObject({
      revision: 1,
      import_id: importId,
      tarifa_unidad_canonical: '12.5000',
      descripcion_generica: 'GENERICO HTTP',
      descripcion_comercial: 'COMERCIAL HTTP',
      laboratorio: 'LAB HTTP',
      provenance: 'CONFIRM:tariff_annex_import:new_product',
    });

    expect(revisions.rows[0]?.import_row_id).not.toBeNull();
  });

  it('CONFIRM repetido es HTTP-idempotente y no duplica revisión', async () => {
    const firstCount = await database.query<{
      count: number;
    }>(
      `
              select count(*)::int as count
              from tariff_product_revisions r
              join tariff_annex_products p
                on p.id = r.product_id
              where p.codigo_producto = $1
            `,
      [commercialCode],
    );

    const response = await apiJson(
      'POST',
      `/admin/tariff-annex/imports/${importId}/confirm`,
      adminToken,
      mtdOrganizationId,
      {},
    );

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      outcome: string;
    };

    expect(payload.outcome).toBe('completed');

    const secondCount = await database.query<{
      count: number;
    }>(
      `
              select count(*)::int as count
              from tariff_product_revisions r
              join tariff_annex_products p
                on p.id = r.product_id
              where p.codigo_producto = $1
            `,
      [commercialCode],
    );

    expect(secondCount.rows[0]?.count).toBe(firstCount.rows[0]?.count);

    expect(secondCount.rows[0]?.count).toBe(1);
  });
});
