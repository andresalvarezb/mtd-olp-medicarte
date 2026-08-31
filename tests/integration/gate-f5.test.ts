import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
const medicarteOrganizationId = '10000000-0000-4000-8000-000000000004';
const adminUserId = '40000000-0000-4000-8000-000000000001';

const database = new Client({ connectionString: databaseUrl });
let olpToken: string;
let medicarteToken: string;
let adminToken: string;

async function login(username: string, password: string): Promise<string> {
  const response = await fetch(
    'http://localhost:8080/realms/authorization/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'authorization-web',
        username,
        password,
      }),
    },
  );
  if (!response.ok) throw new Error(`Login failed: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
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
      values ($1, $2, $3, 'phase5.csv', 'text/csv', 1, $4, 1, 'COMPLETADO', 1, 1, 1)`,
    [batchId, mtdOrganizationId, adminUserId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
  );
  await database.query(
    `insert into authorization_items
       (id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
        source_status_normalized, source_prescripcion_normalized, no_prescripcion,
        enablement_status, coverage_type, direction_status, operation_status,
        coverage_rule_version, tariff_membership_status, lugar_dispensacion, operational_version, created_from_batch_id)
     values ($1, $2, $3, $4, '{}'::jsonb, '5', '', '', 'HABILITADO', 'PBS',
             'NO_APLICA', 'LISTO_PARA_DISPENSAR', 'F2-COVERAGE-2', 'LISTADO', 'Sede logística F5', 1, $5)`,
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
    operationType === 'REPORT_DISPENSATION_DATE'
      ? 'fecha_dispensacion'
      : 'fecha_aplicacion_medicamento';
  if (operationType === 'REPORT_DISPENSATION_DATE') {
    return [
      `authorization_key,${field}${extraColumn ? ',campo_extra' : ''}`,
      `${item.authorization}:${item.medication},${value}${extraColumn ? ',no-permitido' : ''}`,
      '',
    ].join('\n');
  }
  return [
    `authorization_key,${field}${extraColumn ? ',campo_extra' : ''}`,
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
       if (batch.status === 'COMPLETADO' || batch.status === 'FALLIDO') return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('F5 bulk batch never settled');
}

async function getBatchRows(
  token: string,
  organizationId: string,
  batchId: string,
): Promise<
  Array<{
    resultCode: string;
    authorizationKey: string | null;
    previousValue: string | null;
    newValue: string | null;
  }>
> {
  const response = await fetch(`${apiUrl}/api/v1/bulk-updates/${batchId}/rows?limit=100`, {
    headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
  });
  expect(response.status).toBe(200);
  return (
    (await response.json()) as {
      items: Array<{
        resultCode: string;
        authorizationKey: string | null;
        previousValue: string | null;
        newValue: string | null;
      }>;
    }
  ).items;
}

describe('Gate F5', () => {
  beforeAll(async () => {
    await database.connect();
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
       status: 'COMPLETADO',
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
       operation_status: 'DISPENSACION_REPORTADA',
       audit_status: 'NO_INICIADO',
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
       operation_status: 'DISPENSACION_REPORTADA',
       audit_status: 'LISTO',
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

  it('solo lista registros con fecha de aplicación cuando se solicita el filtro', async () => {
    const withApplicationDate = await seedReadyItem('SUPPORTS-FILTER-VISIBLE');
    const withoutApplicationDate = await seedReadyItem('SUPPORTS-FILTER-PENDING');

    const dispensing = await createBulk({
      token: olpToken,
      organizationId: olpOrganizationId,
      operationType: 'REPORT_DISPENSATION_DATE',
      content: dateCsv('REPORT_DISPENSATION_DATE', withApplicationDate, '2026-08-29'),
    });
    expect(dispensing.status).toBe(202);
    const dispensingBatch = (await dispensing.json()) as { id: string };
    expect(await waitForBatch(olpToken, olpOrganizationId, dispensingBatch.id)).toMatchObject({
       status: 'COMPLETADO',
      updatedRows: 1,
      rejectedRows: 0,
    });

    const application = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: dateCsv('REPORT_APPLICATION_DATE', withApplicationDate, '2026-08-30'),
    });
    expect(application.status).toBe(202);
    const applicationBatch = (await application.json()) as { id: string };
    expect(
      await waitForBatch(medicarteToken, medicarteOrganizationId, applicationBatch.id),
    ).toMatchObject({
       status: 'COMPLETADO',
      updatedRows: 1,
      rejectedRows: 0,
    });

    const response = await fetch(
       `${apiUrl}/api/v1/authorization-items?applicationDateStatus=PRESENTE&limit=100`,
      {
        headers: {
          authorization: `Bearer ${medicarteToken}`,
          'x-organization-id': medicarteOrganizationId,
        },
      },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ id: string; fechaAplicacion: string | null }>;
    };
    expect(body.items.some((item) => item.id === withApplicationDate.id)).toBe(true);
    expect(body.items.some((item) => item.id === withoutApplicationDate.id)).toBe(false);
    expect(body.items.every((item) => item.fechaAplicacion !== null)).toBe(true);
  });

  it('descarga para MEDICARTE solo la base visible con la llave y fecha de aplicación', async () => {
    const visible = await seedReadyItem('APPLICATION-EXPORT-VISIBLE');
    const outside = await seedReadyItem('APPLICATION-EXPORT-OUTSIDE');
    await database.query(
      `delete from authorization_item_organizations
       where authorization_item_id = $1 and organization_id = $2`,
      [outside.id, medicarteOrganizationId],
    );
    const response = await fetch(
      `${apiUrl}/api/v1/operational-exports/authorization-items?operationType=REPORT_APPLICATION_DATE&format=csv`,
      {
        headers: {
          authorization: `Bearer ${medicarteToken}`,
          'x-organization-id': medicarteOrganizationId,
        },
      },
    );
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.split('\n')[0]).toContain('authorization_key');
    expect(csv.split('\n')[0]).toContain('fecha_aplicacion_medicamento');
    expect(csv).toContain(`${visible.authorization}:${visible.medication}`);
    expect(csv).not.toContain(`${outside.authorization}:${outside.medication}`);

    const protectedKeyItem = await seedReadyItem('APPLICATION-EXPORT-PROTECTED-KEY');
    const protectedAuthorization = `-${protectedKeyItem.authorization}`;
    await database.query(
      `update authorization_items
       set numero_autorizacion = $2, authorization_key = $3
       where id = $1`,
      [
        protectedKeyItem.id,
        protectedAuthorization,
        `${protectedAuthorization}:${protectedKeyItem.medication}`,
      ],
    );
    const protectedExport = await fetch(
      `${apiUrl}/api/v1/operational-exports/authorization-items?operationType=REPORT_APPLICATION_DATE&format=csv`,
      {
        headers: {
          authorization: `Bearer ${medicarteToken}`,
          'x-organization-id': medicarteOrganizationId,
        },
      },
    );
    expect(await protectedExport.text()).toContain(`'${protectedAuthorization}`);
    const roundTrip = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: [
        'authorization_key,fecha_aplicacion_medicamento',
        `'${protectedAuthorization}:${protectedKeyItem.medication},2026-08-30`,
        '',
      ].join('\n'),
    });
    const roundTripBody = (await roundTrip.json()) as { id: string };
    expect(
      await waitForBatch(medicarteToken, medicarteOrganizationId, roundTripBody.id),
    ).toMatchObject({ updatedRows: 1, rejectedRows: 0 });

    const ambiguousItem = await seedReadyItem('APPLICATION-EXPORT-AMBIGUOUS-KEY');
    await database.query(
      `update authorization_items
       set numero_autorizacion = $2, codigo_medicamento = $3, authorization_key = $4
       where id = $1`,
      [
        ambiguousItem.id,
        `'${protectedAuthorization}`,
        protectedKeyItem.medication,
        `'${protectedAuthorization}:${protectedKeyItem.medication}`,
      ],
    );
    const ambiguous = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: [
        'authorization_key,fecha_aplicacion_medicamento',
        `'${protectedAuthorization}:${protectedKeyItem.medication},2026-08-31`,
        '',
      ].join('\n'),
    });
    const ambiguousBody = (await ambiguous.json()) as { id: string };
    expect(
      await waitForBatch(medicarteToken, medicarteOrganizationId, ambiguousBody.id),
    ).toMatchObject({ updatedRows: 0, rejectedRows: 1 });
    expect(await getBatchRows(medicarteToken, medicarteOrganizationId, ambiguousBody.id)).toEqual([
      expect.objectContaining({ resultCode: 'VERSION_CONFLICT' }),
    ]);
    const audit = await database.query<{ result: string; after: { operationType?: string } }>(
      `select result, after from audit_events
       where action = 'OPERATIONAL_EXPORT_CREATED' and organization_id = $1 order by occurred_at desc limit 1`,
      [medicarteOrganizationId],
    );
    expect(audit.rows[0]).toMatchObject({
      result: 'SUCCESS',
      after: { operationType: 'REPORT_APPLICATION_DATE' },
    });
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
       expect(batch.status).toBe('COMPLETADO');
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

  it('procesa parcialmente el contrato reducido de aplicación y reporta cada causal', async () => {
    const first = await seedReadyItem('APPLICATION-PARTIAL-1');
    const second = await seedReadyItem('APPLICATION-PARTIAL-2');
    const invalidDate = await seedReadyItem('APPLICATION-INVALID-DATE');
    const emptyDate = await seedReadyItem('APPLICATION-EMPTY-DATE');
    const outsideScope = await seedReadyItem('APPLICATION-OUTSIDE');
    await database.query(
      `delete from authorization_item_organizations
       where authorization_item_id = $1 and organization_id = $2`,
      [outsideScope.id, medicarteOrganizationId],
    );
    const content = [
      'authorization_key,fecha_aplicacion_medicamento',
      `${first.authorization}:${first.medication},2026-08-30`,
      `${second.authorization}:${second.medication},2026-08-31`,
      `${second.authorization}:${second.medication},2026-08-31`,
      `${invalidDate.authorization}:${invalidDate.medication},2026-02-29`,
      `${emptyDate.authorization}:${emptyDate.medication},`,
      'AUTH-NO-EXISTE:MED-NO-EXISTE,2026-08-30',
      `${outsideScope.authorization}:${outsideScope.medication},2026-08-30`,
      '',
    ].join('\n');
    const response = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content,
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string };
    expect(await waitForBatch(medicarteToken, medicarteOrganizationId, body.id)).toMatchObject({
       status: 'COMPLETADO',
      updatedRows: 2,
      rejectedRows: 5,
    });
    const rows = await getBatchRows(medicarteToken, medicarteOrganizationId, body.id);
    expect(rows.map((row) => row.resultCode)).toEqual(
      expect.arrayContaining([
        'ROW_UPDATED',
        'DUPLICATE_KEY_IN_FILE',
        'INVALID_VALUE_FORMAT',
        'MISSING_VALUE',
        'AUTHORIZATION_ITEM_NOT_FOUND',
        'FORBIDDEN_ITEM_SCOPE',
      ]),
    );
    const persisted = await database.query<{ id: string; fecha_aplicacion: string | null }>(
      `select id, fecha_aplicacion::text from authorization_items where id = any($1::uuid[]) order by id`,
      [[first.id, second.id, invalidDate.id, emptyDate.id, outsideScope.id]],
    );
    expect(persisted.rows.filter((row) => row.fecha_aplicacion !== null)).toHaveLength(2);
  });

  it('mantiene idempotencia, corrige con trazabilidad y no altera campos ajenos', async () => {
    const item = await seedReadyItem('APPLICATION-IDEMPOTENT');
    const before = await database.query<{
      numero_autorizacion: string;
      codigo_medicamento: string;
      authorization_key: string;
      lugar_dispensacion: string;
      operation_status: string;
      audit_status: string;
      source_data: Record<string, unknown>;
    }>(
      `select numero_autorizacion, codigo_medicamento, authorization_key, lugar_dispensacion,
              operation_status, audit_status, source_data
       from authorization_items where id = $1`,
      [item.id],
    );
    const firstContent = dateCsv('REPORT_APPLICATION_DATE', item, '2026-08-29');
    const idempotencyKey = randomUUID();
    const first = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: firstContent,
      idempotencyKey,
    });
    const firstBody = (await first.json()) as { id: string };
    await waitForBatch(medicarteToken, medicarteOrganizationId, firstBody.id);
    const replay = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: firstContent,
      idempotencyKey,
    });
    expect(((await replay.json()) as { id: string }).id).toBe(firstBody.id);

    const unchanged = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: `${firstContent}\n`,
    });
    const unchangedBody = (await unchanged.json()) as { id: string };
    const unchangedBatch = await waitForBatch(
      medicarteToken,
      medicarteOrganizationId,
      unchangedBody.id,
    );
    expect(unchangedBatch.unchangedRows).toBe(1);

    const correction = await createBulk({
      token: medicarteToken,
      organizationId: medicarteOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: dateCsv('REPORT_APPLICATION_DATE', item, '2026-08-30'),
    });
    const correctionBody = (await correction.json()) as { id: string };
    await waitForBatch(medicarteToken, medicarteOrganizationId, correctionBody.id);
    expect(await getBatchRows(medicarteToken, medicarteOrganizationId, correctionBody.id)).toEqual([
      expect.objectContaining({
        resultCode: 'ROW_UPDATED',
        previousValue: '2026-08-29',
        newValue: '2026-08-30',
      }),
    ]);

    const after = await database.query<{
      numero_autorizacion: string;
      codigo_medicamento: string;
      authorization_key: string;
      lugar_dispensacion: string;
      operation_status: string;
      audit_status: string;
      source_data: Record<string, unknown>;
      fecha_aplicacion: string;
    }>(
      `select numero_autorizacion, codigo_medicamento, authorization_key, lugar_dispensacion,
              operation_status, audit_status, source_data, fecha_aplicacion::text
       from authorization_items where id = $1`,
      [item.id],
    );
    expect(after.rows[0]).toMatchObject({ ...before.rows[0], fecha_aplicacion: '2026-08-30' });
    const audit = await database.query<{
      organization_id: string;
      after: { authorizationKey?: string; batchId?: string; field?: string; value?: string };
    }>(
      `select organization_id, after from audit_events
       where resource_id = $1 and action = 'APPLICATION_DATE_REPORTED' order by occurred_at`,
      [item.id],
    );
    expect(audit.rows).toHaveLength(2);
    expect(audit.rows[1]).toMatchObject({
      organization_id: medicarteOrganizationId,
      after: {
        authorizationKey: `${item.authorization}:${item.medication}`,
        batchId: correctionBody.id,
        field: 'fecha_aplicacion',
        value: '2026-08-30',
      },
    });
  });

  it('rechaza permiso y encabezados incorrectos para la aplicación', async () => {
    const item = await seedReadyItem('APPLICATION-CONTRACT');
    const unauthorized = await createBulk({
      token: olpToken,
      organizationId: olpOrganizationId,
      operationType: 'REPORT_APPLICATION_DATE',
      content: dateCsv('REPORT_APPLICATION_DATE', item, '2026-08-30'),
    });
    expect(unauthorized.status).toBe(403);

    for (const content of [
      `numero_autorizacion,codigo_medicamento,fecha_aplicacion\n${item.authorization},${item.medication},2026-08-30\n`,
      dateCsv('REPORT_APPLICATION_DATE', item, '2026-08-30', true),
    ]) {
      const response = await createBulk({
        token: medicarteToken,
        organizationId: medicarteOrganizationId,
        operationType: 'REPORT_APPLICATION_DATE',
        content,
      });
      const body = (await response.json()) as { id: string };
      expect(await waitForBatch(medicarteToken, medicarteOrganizationId, body.id)).toMatchObject({
         status: 'FALLIDO',
        lastErrorCode: 'INVALID_HEADERS',
      });
    }
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
       status: 'COMPLETADO',
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
       status: 'FALLIDO',
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
    expect(csv).toContain('lugar_dispensacion');
    expect(csv).toContain('fecha_dispensacion');
    expect(csv).toContain('fecha_aplicacion_medicamento');
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
       set status = 'PENDIENTE', dispatched_at = null, processed_at = null, available_at = now()
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
       set audit_status = 'APROBADO', operation_status = 'DISPENSADO'
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
     ).toMatchObject({ status: 'COMPLETADO', rejectedRows: 1, updatedRows: 0 });
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
       audit_status: 'APROBADO',
       operation_status: 'DISPENSADO',
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
