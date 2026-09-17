import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login } from './helpers/auth';

const api = process.env.API_URL ?? 'http://127.0.0.1:3001';
const org = '10000000-0000-4000-8000-000000000001';

const database = new Client({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://postgres:local-analysis-only@127.0.0.1:55432/authorization_agent_analysis',
});

const mime =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let token: string;

type TariffImportResponse = {
  id: string;
  status: string;
  preview: {
    changed: number;
    anomalous: number;
  };
};

type SnapshotRow = {
  status: string;
  tarifa_unidad_raw: string;
  tarifa_unidad_canonical: string;
  provenance: string;
  product_id: string;
  product_revision_id: string | null;
};

function writeWorkbookBuffer(workbook: XLSX.WorkBook): Buffer {
  const output: unknown = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });

  if (!Buffer.isBuffer(output)) {
    throw new Error('XLSX_BUFFER_EXPECTED');
  }

  return output;
}

function file(code: string, tariff: number, marker = 'E2E'): Buffer {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
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
      [code, tariff, marker, '1', marker, marker, marker, 'PBS'],
    ]),
    'Datos',
  );

  return writeWorkbookBuffer(workbook);
}

async function createImport(content: Buffer): Promise<TariffImportResponse> {
  const form = new FormData();

  form.append(
    'file',
    new Blob([content], { type: mime }),
    'e2e.xlsx',
  );

  const response = await fetch(
    `${api}/api/v1/admin/tariff-annex/imports`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-organization-id': org,
        'idempotency-key': randomUUID(),
      },
      body: form,
    },
  );

  expect(response.status).toBe(202);

  const body = (await response.json()) as unknown;

  return body as TariffImportResponse;
}

describe('tariff HTTP and worker E2E', () => {
  beforeAll(async () => {
    await database.connect();
    token = await login('foundation-admin', 'foundation-admin');
  });

  afterAll(async () => {
    await database.end();
  });

  it('runs prepare, confirm, outbox and worker for normal import', async () => {
    const code = `E2E-SNAPSHOT-${randomUUID().slice(0, 8)}`;
    const prepared = await createImport(file(code, 1234));

    expect(prepared.status).toBe('PREPARED');
    expect(prepared.preview.changed).toBeGreaterThanOrEqual(1);

    const productsBefore = await database.query<{ count: number }>(
      `select count(*)::int as count
       from tariff_annex_products
       where codigo_producto=$1`,
      [code],
    );

    expect(productsBefore.rows[0]?.count).toBe(0);

    const outboxBefore = await database.query<{ count: number }>(
      `select count(*)::int as count
       from outbox_events
       where payload->>'batchId'=$1`,
      [prepared.id],
    );

    expect(outboxBefore.rows[0]?.count).toBe(0);

    const confirm = await fetch(
      `${api}/api/v1/admin/tariff-annex/imports/${prepared.id}/confirm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': org,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: '{}',
      },
    );

    expect(confirm.status).toBe(200);

    for (let i = 0; i < 50; i += 1) {
      const row = await database.query<{ status: string }>(
        'select status from tariff_annex_imports where id=$1',
        [prepared.id],
      );

      if (row.rows[0]?.status === 'COMPLETED') break;

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const completed = await database.query<{ status: string }>(
      'select status from tariff_annex_imports where id=$1',
      [prepared.id],
    );

    expect(completed.rows[0]?.status).toBe('COMPLETED');

    const outbox = await database.query<{ count: number }>(
      `select count(*)::int as count
       from outbox_events
       where idempotency_key=$1`,
      [`tariff-confirm:${prepared.id}`],
    );

    expect(outbox.rows[0]?.count).toBe(1);

    const product = await database.query<{
      tarifa_unidad_canonical: string;
    }>(
      `select tarifa_unidad_canonical
       from tariff_annex_products
       where codigo_producto=$1
       limit 1`,
      [code],
    );

    expect(product.rows[0]?.tarifa_unidad_canonical).toBe('1234.0000');

    const authorizationWorkbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      authorizationWorkbook,
      XLSX.utils.aoa_to_sheet([
        [
          'NUMERO_AUTORIZACION',
          'COD_COMERCIAL',
          'ESTADO_AUTORIZACION',
          'No.PRESCRIPCION',
          'FECHA_FINAL_VIGENCIA',
        ],
        [
          `E2E-AUTH-${randomUUID().slice(0, 8)}`,
          code,
          '5',
          '',
          '2099-12-31',
        ],
      ]),
      'Datos',
    );

    const authorizationFile =
      writeWorkbookBuffer(authorizationWorkbook);

    const authForm = new FormData();

    authForm.append(
      'file',
      new Blob([authorizationFile], { type: mime }),
      'authorization.xlsx',
    );

    const authCreate = await fetch(
      `${api}/api/v1/imports`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': org,
          'idempotency-key': randomUUID(),
        },
        body: authForm,
      },
    );

    expect(authCreate.status).toBe(202);

    const authBody = (await authCreate.json()) as unknown;
    const authBatch = authBody as { id: string };

    for (let i = 0; i < 50; i += 1) {
      const batch = await database.query<{ status: string }>(
        'select status from import_batches where id=$1',
        [authBatch.id],
      );

      if (batch.rows[0]?.status === 'READY_TO_CONFIRM') break;

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const authConfirm = await fetch(
      `${api}/api/v1/imports/${authBatch.id}/confirm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': org,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: '{}',
      },
    );

    expect(authConfirm.status).toBe(200);

    let itemId: string | undefined;
    let snapshot: SnapshotRow | undefined;

    for (let i = 0; i < 75; i += 1) {
      const item = await database.query<{ id: string }>(
        `select id
         from authorization_items
         where codigo_medicamento=$1
         order by created_at desc
         limit 1`,
        [code],
      );

      itemId = item.rows[0]?.id;

      if (itemId) {
        const result = await database.query<SnapshotRow>(
          `select
             status,
             tarifa_unidad_raw,
             tarifa_unidad_canonical,
             provenance,
             product_id,
             product_revision_id
           from authorization_tariff_snapshots
           where authorization_item_id=$1`,
          [itemId],
        );

        snapshot = result.rows[0];

        if (snapshot) break;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(itemId).toBeDefined();

    expect(snapshot).toMatchObject({
      status: 'RESOLVED',
      tarifa_unidad_raw: '1234',
      tarifa_unidad_canonical: '1234.0000',
      provenance: 'AUTHORIZATION_CREATE:active_tariff_revision',
    });

    expect(snapshot?.product_revision_id).toBeTruthy();

    const before = await database.query<{
      tarifa_unidad_raw: string;
      tarifa_unidad_canonical: string;
      product_revision_id: string | null;
    }>(
      `select
         tarifa_unidad_raw,
         tarifa_unidad_canonical,
         product_revision_id
       from authorization_tariff_snapshots
       where authorization_item_id=$1`,
      [itemId],
    );

    await database.query(
      `update tariff_annex_products
       set tarifa_unidad='9999',
           tarifa_unidad_canonical=9999
       where codigo_producto=$1`,
      [code],
    );

    const after = await database.query<{
      tarifa_unidad_raw: string;
      tarifa_unidad_canonical: string;
      product_revision_id: string | null;
    }>(
      `select
         tarifa_unidad_raw,
         tarifa_unidad_canonical,
         product_revision_id
       from authorization_tariff_snapshots
       where authorization_item_id=$1`,
      [itemId],
    );

    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('blocks anomaly over HTTP and applies it only with explicit override', async () => {
    const code = `E2E-ANOMALY-${randomUUID().slice(0, 8)}`;

    const baseline = await createImport(
      file(code, 7420, randomUUID()),
    );

    expect(baseline.status).toBe('PREPARED');

    const baselineConfirm = await fetch(
      `${api}/api/v1/admin/tariff-annex/imports/${baseline.id}/confirm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': org,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: '{}',
      },
    );

    expect(baselineConfirm.status).toBe(200);

    for (let i = 0; i < 50; i += 1) {
      const row = await database.query<{ status: string }>(
        'select status from tariff_annex_imports where id=$1',
        [baseline.id],
      );

      if (row.rows[0]?.status === 'COMPLETED') break;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const prepared = await createImport(
      file(code, 7.42, randomUUID()),
    );

    expect(prepared.preview.anomalous).toBe(1);

    const blocked = await fetch(
      `${api}/api/v1/admin/tariff-annex/imports/${prepared.id}/confirm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': org,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: '{}',
      },
    );

    expect(blocked.status).toBe(409);

    const current = await database.query<{
      tarifa_unidad: string;
    }>(
      `select tarifa_unidad
       from tariff_annex_products
       where codigo_producto=$1
       limit 1`,
      [code],
    );

    expect(current.rows[0]?.tarifa_unidad).toBe('7420');

    const reason = 'E2E approved tariff correction';

    const confirmed = await fetch(
      `${api}/api/v1/admin/tariff-annex/imports/${prepared.id}/confirm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': org,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          overrideReason: reason,
        }),
      },
    );

    expect(confirmed.status).toBe(200);

    await fetch(
      `${api}/api/v1/admin/tariff-annex/imports/${prepared.id}/confirm`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-organization-id': org,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          overrideReason: reason,
        }),
      },
    );

    for (let i = 0; i < 50; i += 1) {
      const row = await database.query<{ status: string }>(
        'select status from tariff_annex_imports where id=$1',
        [prepared.id],
      );

      if (row.rows[0]?.status === 'COMPLETED') break;

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const outbox = await database.query<{ count: number }>(
      `select count(*)::int as count
       from outbox_events
       where idempotency_key=$1`,
      [`tariff-confirm:${prepared.id}`],
    );

    expect(outbox.rows[0]?.count).toBe(1);

    const audit = await database.query<{
      after: {
        overrideReason?: string;
      };
    }>(
      `select after
       from audit_events
       where action='TARIFF_ANNEX_IMPORT_CONFIRMED'
         and resource_id=$1
       order by occurred_at desc
       limit 1`,
      [prepared.id],
    );

    expect(audit.rows[0]?.after.overrideReason).toBe(reason);
  });
});
