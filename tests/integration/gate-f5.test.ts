import { randomUUID } from 'node:crypto';
import { loginDev } from './helpers/auth';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
const medicarteOrganizationId = '10000000-0000-4000-8000-000000000004';
let adminUserId: string;

const database = new Client({ connectionString: databaseUrl });
let olpToken: string;
let medicarteToken: string;
let adminToken: string;

async function login(username: string, password: string): Promise<string> {
  return loginDev(username, password); // ADR-026
}

async function seedReadyItem(label: string): Promise<{
  id: string;
  authorization: string;
  medication: string;
}> {
  const batchId = randomUUID();
  const authorization = `AUTH-F5-${label}-${randomUUID()}`.toUpperCase();
  const medication = `MED-F5-${label}`.toUpperCase();
  const itemId = randomUUID();
  await database.query(
    `insert into import_batches
       (id, organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
        processor_version, status, total_rows, valid_rows, confirmed_rows)
     values ($1, $2, $3, 'phase5.csv', 'text/csv', 1, $4, 1, 'COMPLETED', 1, 1, 1)`,
    [batchId, mtdOrganizationId, adminUserId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  await database.query(
    `insert into authorization_items
       (id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
        source_status_normalized, source_prescripcion_normalized, no_prescripcion,
        enablement_status, coverage_type, direction_status, operation_status,
        coverage_rule_version, lugar_dispensacion, operational_version,
        tariff_membership_status, tariff_membership_evaluated_at, created_from_batch_id)
     values ($1, $2, $3, $4, '{}'::jsonb, '5', '', '', 'ENABLED', 'PBS',
             'NOT_APPLICABLE', 'READY_TO_DISPENSE', 'F2-COVERAGE-2', 'Sede logística F5', 1,
             'LISTED', now(), $5)`,
    [itemId, authorization, medication, `${authorization}:${medication}`, batchId],
  );
  await database.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2), ($1, $3)`,
    [itemId, olpOrganizationId, medicarteOrganizationId],
  );
  return { id: itemId, authorization, medication };
}

function dateCsv(
  operationType: 'REPORT_DISPENSATION_DATE' | 'REPORT_APPLICATION_DATE',
  item: { authorization: string; medication: string },
  value: string,
  extraColumn = false,
): string {
  const field =
    operationType === 'REPORT_DISPENSATION_DATE' ? 'FECHA_DISPENSACION' : 'FECHA_APLICACION';
  if (operationType === 'REPORT_DISPENSATION_DATE') {
    return [
      `CLAVE_AUTORIZACION,${field}${extraColumn ? ',CAMPO_EXTRA' : ''}`,
      `${item.authorization}:${item.medication},${value}${extraColumn ? ',no-permitido' : ''}`,
      '',
    ].join('\n');
  }
  return [
    `CLAVE_AUTORIZACION,${field}${extraColumn ? ',CAMPO_EXTRA' : ''}`,
    `${item.authorization}:${item.medication},${value}${extraColumn ? ',no-permitido' : ''}`,
    '',
  ].join('\n');
}

async function createBulk(input: {
  token: string;
  organizationId: string;
  operationType: 'REPORT_DISPENSATION_DATE' | 'REPORT_APPLICATION_DATE';
  content: string;
  idempotencyKey?: string;
}): Promise<Response> {
  const form = new FormData();
  form.append('operationType', input.operationType);
  form.append('file', new Blob([input.content], { type: 'text/csv' }), 'phase5.csv');
  return fetch(`${apiUrl}/api/v1/bulk-updates`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      'x-organization-id': input.organizationId,
      'idempotency-key': input.idempotencyKey ?? randomUUID(),
    },
    body: form,
  });
}

async function waitForBatch(
  token: string,
  organizationId: string,
  batchId: string,
): Promise<{
  status: string;
  updatedRows: number;
  unchangedRows: number;
  rejectedRows: number;
  lastErrorCode: string | null;
}> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/v1/bulk-updates/${batchId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
    });
    if (response.ok) {
      const batch = (await response.json()) as {
        status: string;
        updatedRows: number;
        unchangedRows: number;
        rejectedRows: number;
        lastErrorCode: string | null;
      };
      if (batch.status === 'COMPLETED' || batch.status === 'FAILED') return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('F5 bulk batch never settled');
}

describe('Gate F5', () => {
  beforeAll(async () => {
    await database.connect();
    const admin = await database.query<{ id: string }>('select id from users where username = $1', [
      'foundation-admin',
    ]);
    adminUserId = admin.rows[0]?.id ?? '';
    if (!adminUserId) throw new Error('foundation-admin local user missing');
    [olpToken, medicarteToken, adminToken] = await Promise.all([
      login('olp-operator', 'olp-operator'),
      login('medicarte-operator', 'medicarte-operator'),
      login('foundation-admin', 'foundation-admin'),
    ]);
  });

  afterAll(async () => database.end());

  it('procesa dispensación y aplicación, conserva historial y solo habilita auditoría', async () => {
    const item = await seedReadyItem('FLOW');
    const dispensing = await createBulk({
      token: olpToken,
      organizationId: olpOrganizationId,
      operationType: 'REPORT_DISPENSATION_DATE',
      content: dateCsv('REPORT_DISPENSATION_DATE', item, '2026-08-29'),
    });
    expect(dispensing.status).toBe(202);
    const dispensingBatch = (await dispensing.json()) as { id: string };
    expect(await waitForBatch(olpToken, olpOrganizationId, dispensingBatch.id)).toMatchObject({
      status: 'COMPLETED',
      updatedRows: 1,
      rejectedRows: 0,
    });
    const xlsxReport = await fetch(
      `${apiUrl}/api/v1/bulk-updates/${dispensingBatch.id}/report?format=xlsx`,
      {
        headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
      },
    );
    expect(xlsxReport.status).toBe(200);
    expect(xlsxReport.headers.get('content-type')).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const afterDispensing = await database.query<{
      fecha_dispensacion: string;
      operation_status: string;
      audit_status: string;
    }>(
      `select fecha_dispensacion::text, operation_status, audit_status
       from authorization_items where id = $1`,
      [item.id],
    );
    expect(afterDispensing.rows[0]).toEqual({
      fecha_dispensacion: '2026-08-29',
      operation_status: 'DISPENSATION_REPORTED',
      audit_status: 'NOT_STARTED',
    });

    const application = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: dateCsv('REPORT_APPLICATION_DATE', item, '2026-08-30'),
    });
    expect(application.status).toBe(202);
    const applicationBatch = (await application.json()) as { id: string };
    await waitForBatch(medicarteToken, medicarteOrganizationId, applicationBatch.id);

    const completed = await database.query<{
      fecha_aplicacion: string;
      operation_status: string;
      audit_status: string;
      operational_version: number;
    }>(
      `select fecha_aplicacion::text, operation_status, audit_status, operational_version
       from authorization_items where id = $1`,
      [item.id],
    );
    expect(completed.rows[0]).toMatchObject({
      fecha_aplicacion: '2026-08-30',
      operation_status: 'DISPENSATION_REPORTED',
      audit_status: 'READY',
      operational_version: 3,
    });
    const history = await database.query<{
      field_name: string;
      previous_value: string | null;
      new_value: string;
      actor_id: string;
      organization_id: string;
      bulk_update_batch_id: string;
      bulk_update_row_id: string;
      idempotency_key: string;
    }>(
      `select field_name, previous_value, new_value, actor_id, organization_id,
              bulk_update_batch_id, bulk_update_row_id, idempotency_key
       from operational_field_changes where authorization_item_id = $1 order by created_at`,
      [item.id],
    );
    expect(history.rows.map((row) => row.field_name)).toEqual([
      'fecha_dispensacion',
      'fecha_aplicacion',
    ]);
    expect(
      history.rows.every(
        (row) =>
          row.actor_id &&
          row.organization_id &&
          row.bulk_update_batch_id &&
          row.bulk_update_row_id &&
          row.idempotency_key,
      ),
    ).toBe(true);
  });

  it('permite corrección, reporta sin cambio y no pierde versiones', async () => {
    const item = await seedReadyItem('CORRECTION');
    for (const value of ['2026-08-27', '2026-08-28', '2026-08-28']) {
      const response = await createBulk({
        token: olpToken,
        organizationId: olpOrganizationId,
        operationType: 'REPORT_DISPENSATION_DATE',
        content: dateCsv('REPORT_DISPENSATION_DATE', item, value),
      });
      const body = (await response.json()) as { id: string };
      const batch = await waitForBatch(olpToken, olpOrganizationId, body.id);
      expect(batch.status).toBe('COMPLETED');
    }
    const history = await database.query<{ previous_value: string | null; new_value: string }>(
      `select previous_value, new_value from operational_field_changes
       where authorization_item_id = $1 and field_name = 'fecha_dispensacion' order by created_at`,
      [item.id],
    );
    expect(history.rows).toEqual([
      { previous_value: null, new_value: '2026-08-27' },
      { previous_value: '2026-08-27', new_value: '2026-08-28' },
    ]);
  });

  it('rechaza actor cruzado, fecha inválida y columnas extra', async () => {
    const item = await seedReadyItem('SECURITY');
    const crossed = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_DISPENSATION_DATE',
      content: dateCsv('REPORT_DISPENSATION_DATE', item, '2026-08-29'),
    });
    expect(crossed.status).toBe(403);

    const invalid = await createBulk({
      token: olpToken,
      organizationId: olpOrganizationId,
      operationType: 'REPORT_DISPENSATION_DATE',
      content: dateCsv('REPORT_DISPENSATION_DATE', item, '2026-02-29'),
    });
    const invalidBody = (await invalid.json()) as { id: string };
    expect(await waitForBatch(olpToken, olpOrganizationId, invalidBody.id)).toMatchObject({
      status: 'COMPLETED',
      rejectedRows: 1,
    });

    const extra = await createBulk({
      token: olpToken,
      organizationId: olpOrganizationId,
      operationType: 'REPORT_DISPENSATION_DATE',
      content: dateCsv('REPORT_DISPENSATION_DATE', item, '2026-08-29', true),
    });
    const extraBody = (await extra.json()) as { id: string };
    expect(await waitForBatch(olpToken, olpOrganizationId, extraBody.id)).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'INVALID_HEADERS',
    });
    const crossBatchRead = await fetch(`${apiUrl}/api/v1/bulk-updates/${extraBody.id}`, {
      headers: {
        authorization: `Bearer ${medicarteToken}`,
        'x-organization-id': medicarteOrganizationId,
      },
    });
    expect(crossBatchRead.status).toBe(404);

    const outsideScope = await seedReadyItem('OUTSIDE-SCOPE');
    await database.query(
      `delete from authorization_item_organizations
       where authorization_item_id = $1 and organization_id = $2`,
      [outsideScope.id, olpOrganizationId],
    );
    const outside = await createBulk({
      token: olpToken,
      organizationId: olpOrganizationId,
      operationType: 'REPORT_DISPENSATION_DATE',
      content: dateCsv('REPORT_DISPENSATION_DATE', outsideScope, '2026-08-29'),
    });
    const outsideBody = (await outside.json()) as { id: string };
    await waitForBatch(olpToken, olpOrganizationId, outsideBody.id);
    const rows = await fetch(`${apiUrl}/api/v1/bulk-updates/${outsideBody.id}/rows`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    const rowsBody = (await rows.json()) as {
      items: Array<{ resultCode: string; authorizationItemId: string | null }>;
    };
    expect(rowsBody.items[0]).toMatchObject({
      resultCode: 'FORBIDDEN_ITEM_SCOPE',
      authorizationItemId: null,
    });
  });

  it('deduplica creación concurrente y exporta a OLP el lugar permitido', async () => {
    const item = await seedReadyItem('REPLAY');
    const pending = await seedReadyItem('NO-LOCATION');
    await database.query(`update authorization_items set lugar_dispensacion = null where id = $1`, [
      pending.id,
    ]);
    const content = dateCsv('REPORT_DISPENSATION_DATE', item, '2026-08-29');
    const responses = await Promise.all([
      createBulk({
        token: olpToken,
        organizationId: olpOrganizationId,
        operationType: 'REPORT_DISPENSATION_DATE',
        content,
      }),
      createBulk({
        token: olpToken,
        organizationId: olpOrganizationId,
        operationType: 'REPORT_DISPENSATION_DATE',
        content,
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const ids = await Promise.all(
      responses.map(async (response) => ((await response.json()) as { id: string }).id),
    );
    expect(new Set(ids).size).toBe(1);
    await waitForBatch(olpToken, olpOrganizationId, ids[0]!);

    const exportResponse = await fetch(
      `${apiUrl}/api/v1/operational-exports/authorization-items?operationType=REPORT_DISPENSATION_DATE&format=csv`,
      {
        headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
      },
    );
    expect(exportResponse.status).toBe(200);
    const csv = await exportResponse.text();
    expect(csv).toContain('LUGAR_DISPENSACION');
    expect(csv).toContain('FECHA_PROGRAMADA');
    expect(csv).toContain('fecha_dispensacion');
    expect(csv).toContain('fecha_aplicacion');
    expect(csv).toContain(item.authorization);
    expect(csv).not.toContain(pending.authorization);
    expect(csv).toContain('NOMBRE_PACIENTE');
    expect(csv).toContain('NUM_DOCUMENTO');
    expect(csv).toContain('CUPS_AUTORIZADO');
    expect(csv).toContain('No.PRESCRIPCION');

    const mtdExport = await fetch(
      `${apiUrl}/api/v1/operational-exports/authorization-items?operationType=REPORT_DISPENSATION_DATE&format=csv`,
      {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      },
    );
    expect(mtdExport.status).toBe(200);
    expect(await mtdExport.text()).toContain(item.authorization);
  });

  it('serializa lotes distintos sobre la misma llave y tolera redelivery del job', async () => {
    const item = await seedReadyItem('CONCURRENT-ROWS');
    const responses = await Promise.all([
      createBulk({
        token: olpToken,
        organizationId: olpOrganizationId,
        operationType: 'REPORT_DISPENSATION_DATE',
        content: dateCsv('REPORT_DISPENSATION_DATE', item, '2026-08-27'),
      }),
      createBulk({
        token: olpToken,
        organizationId: olpOrganizationId,
        operationType: 'REPORT_DISPENSATION_DATE',
        content: dateCsv('REPORT_DISPENSATION_DATE', item, '2026-08-28'),
      }),
    ]);
    const ids = await Promise.all(
      responses.map(async (response) => ((await response.json()) as { id: string }).id),
    );
    await Promise.all(ids.map((id) => waitForBatch(olpToken, olpOrganizationId, id)));
    const afterConcurrent = await database.query<{
      operational_version: number;
      history_count: string;
    }>(
      `select i.operational_version,
              (select count(*)::text from operational_field_changes c
               where c.authorization_item_id = i.id and c.field_name = 'fecha_dispensacion') as history_count
       from authorization_items i where i.id = $1`,
      [item.id],
    );
    expect(afterConcurrent.rows[0]).toEqual({ operational_version: 3, history_count: '2' });

    await database.query(
      `update outbox_events
       set status = 'PENDING', dispatched_at = null, processed_at = null, available_at = now()
       where event_type = 'authorization.bulk-update' and payload->>'batchId' = $1`,
      [ids[0]],
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const afterRedelivery = await database.query<{ count: string }>(
      `select count(*)::text as count from operational_field_changes
       where authorization_item_id = $1 and field_name = 'fecha_dispensacion'`,
      [item.id],
    );
    expect(afterRedelivery.rows[0]?.count).toBe('2');
  });

  it('no modifica una aplicación aprobada y neutraliza fórmulas exportadas', async () => {
    const approved = await seedReadyItem('APPROVED');
    await database.query(
      `update authorization_items
       set audit_status = 'APPROVED', operation_status = 'DISPENSED'
       where id = $1`,
      [approved.id],
    );
    const application = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: dateCsv('REPORT_APPLICATION_DATE', approved, '2026-08-30'),
    });
    const applicationBody = (await application.json()) as { id: string };
    expect(
      await waitForBatch(medicarteToken, medicarteOrganizationId, applicationBody.id),
    ).toMatchObject({ status: 'COMPLETED', rejectedRows: 1, updatedRows: 0 });
    const untouched = await database.query<{
      fecha_aplicacion: string | null;
      audit_status: string;
      operation_status: string;
    }>(
      `select fecha_aplicacion::text, audit_status, operation_status
       from authorization_items where id = $1`,
      [approved.id],
    );
    expect(untouched.rows[0]).toEqual({
      fecha_aplicacion: null,
      audit_status: 'APPROVED',
      operation_status: 'DISPENSED',
    });

    const formula = await seedReadyItem('FORMULA');
    await database.query(`update authorization_items set lugar_dispensacion = $2 where id = $1`, [
      formula.id,
      '=HYPERLINK("https://example.test")',
    ]);
    const exported = await fetch(
      `${apiUrl}/api/v1/operational-exports/authorization-items?operationType=REPORT_DISPENSATION_DATE&format=csv`,
      {
        headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
      },
    );
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain(`'=HYPERLINK`);
  });

  it('no expone flujo individual de soportes', async () => {
    const openApi = await fetch(`${apiUrl}/api/v1/openapi.json`);
    expect(openApi.status).toBe(200);
    const document = (await openApi.json()) as { paths: Record<string, unknown> };
    expect(
      Object.keys(document.paths).some((path) => /attachment|support|drive-file/i.test(path)),
    ).toBe(false);
  });
});
