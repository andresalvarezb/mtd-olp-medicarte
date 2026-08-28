import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  importBatchResponseSchema,
  paginatedAuthorizationItemsResponseSchema,
  paginatedImportRowsResponseSchema,
} from '../../packages/contracts/src/index.js';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
const olpOperatorRoleId = '20000000-0000-4000-8000-000000000004';
const importsConfirmPermissionId = '30000000-0000-4000-8000-000000000005';
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

async function login(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'password', client_id: 'authorization-web', username, password });
  const response = await fetch(`${keycloakUrl}/realms/authorization/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token) throw new Error(`Keycloak login failed for ${username}: ${response.status}`);
  return result.access_token;
}

function csvValue(value: string): string {
  return /[,"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvRow(values: string[]): string {
  return values.map(csvValue).join(',');
}

function authorizationCsv(rows: Array<{ authorization: string; medication: string; coverage: string; status: string }>): string {
  return [
    csvRow(sourceColumns),
    ...rows.map((row) => csvRow([
      'EPS-1', row.authorization, 'CC', '123', 'Paciente de prueba', '3000000000', 'CUPS-1', row.coverage,
      row.medication, 'CUM-1', '900000001', 'Prestador de prueba', 'CUPS-2', 'Medicamento autorizado', '1', '1',
      '2026-08-01', '2026-12-31', row.status, 'prueba F2', 'Medico de prueba', 'comentario', 'source-1', 'FPRO-1', '0',
    ])),
    '',
  ].join('\n');
}

async function createImport(token: string, content: string, key = randomUUID(), filename = 'authorizations.csv'): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), filename);
  const response = await fetch(`${apiUrl}/api/v1/imports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-organization-id': mtdOrganizationId, 'idempotency-key': key },
    body: form,
  });
  if (response.status !== 202) throw new Error(`Import creation failed: ${response.status} ${await response.text()}`);
  return importBatchResponseSchema.parse(await response.json());
}

async function waitForBatch(token: string, batchId: string): Promise<ReturnType<typeof importBatchResponseSchema.parse>> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': mtdOrganizationId },
    });
    const batch = importBatchResponseSchema.parse(await response.json());
    if (batch.status === 'READY_TO_CONFIRM' || batch.status === 'COMPLETED' || batch.status === 'FAILED') return batch;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Import ${batchId} did not finish validation`);
}

async function confirmImport(token: string, batchId: string): Promise<{ status: string; createdRows: number; existingRows: number }> {
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
  if (response.status !== 200) throw new Error(`Import confirmation failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { status: string; createdRows: number; existingRows: number };
}

async function withOlpImportConfirmationPermission<T>(operation: () => Promise<T>): Promise<T> {
  const inserted = await database.query(
    `insert into role_permissions (role_id, permission_id)
     values ($1, $2)
     on conflict do nothing
     returning role_id`,
    [olpOperatorRoleId, importsConfirmPermissionId],
  );
  try {
    return await operation();
  } finally {
    if (inserted.rowCount) {
      await database.query(
        'delete from role_permissions where role_id = $1 and permission_id = $2',
        [olpOperatorRoleId, importsConfirmPermissionId],
      );
    }
  }
}

describe('Gate F2', () => {
  beforeAll(async () => {
    await database.connect();
    [adminToken, olpToken] = await Promise.all([
      login('foundation-admin', 'foundation-admin'),
      login('olp-operator', 'olp-operator'),
    ]);
  });

  afterAll(async () => database.end());

  it('processes CSV staging, classifies PBS/NO PBS, confirms transactionally, and preserves traceability', async () => {
    const authorization = `AUTH-F2-${randomUUID()}`;
    const content = authorizationCsv([
      { authorization, medication: 'MED-PBS', coverage: ' MEDICAMENTOS   POS ', status: '5' },
      { authorization, medication: 'MED-NO-PBS', coverage: ' medicamentos no pos ', status: '5' },
      { authorization, medication: 'MED-NO-PBS', coverage: 'MEDICAMENTOS NO POS', status: '5' },
    ]);
    const batch = await createImport(adminToken, content);
    const ready = await waitForBatch(adminToken, batch.id);
    expect(ready).toMatchObject({ status: 'READY_TO_CONFIRM', totalRows: 3, validRows: 2, duplicateRows: 1, existingRows: 0 });

    const rowsResponse = await fetch(`${apiUrl}/api/v1/imports/${batch.id}/rows?limit=100`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(rowsResponse.status).toBe(200);
    const rows = paginatedImportRowsResponseSchema.parse(await rowsResponse.json());
    expect(rows.items.map((row) => row.resultCode)).toEqual(['ROW_VALID', 'ROW_VALID', 'DUPLICATE_IN_FILE']);
    expect(rows.items[0]?.normalized).toMatchObject({ coverageType: 'PBS', directionStatus: 'NOT_APPLICABLE', enablementStatus: 'ENABLED' });
    expect(rows.items[1]?.normalized).toMatchObject({ coverageType: 'NO_PBS', directionStatus: 'PENDING', enablementStatus: 'ENABLED' });

    const confirmed = await confirmImport(adminToken, batch.id);
    expect(confirmed).toMatchObject({ status: 'COMPLETED', createdRows: 2 });
    const repeatedBatch = await createImport(adminToken, content);
    const repeatedReady = await waitForBatch(adminToken, repeatedBatch.id);
    expect(repeatedReady).toMatchObject({ status: 'READY_TO_CONFIRM', validRows: 0, existingRows: 2, duplicateRows: 1 });
    const repeatedRows = await (await fetch(`${apiUrl}/api/v1/imports/${repeatedBatch.id}/rows?limit=100`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    })).json() as { items: Array<{ resultCode: string }> };
    expect(repeatedRows.items.map((row) => row.resultCode)).toEqual(['EXISTING_ITEM_REVIEW_REQUIRED', 'EXISTING_ITEM_REVIEW_REQUIRED', 'DUPLICATE_IN_FILE']);

    const itemCount = await database.query<{ count: string }>(
      'select count(*)::text as count from authorization_items where numero_autorizacion = $1',
      [authorization.toUpperCase()],
    );
    expect(itemCount.rows[0]?.count).toBe('2');

    const inbox = await fetch(`${apiUrl}/api/v1/authorization-items?authorizationKey=${encodeURIComponent(`${authorization}:`)}&limit=25`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    const inboxResult = paginatedAuthorizationItemsResponseSchema.parse(await inbox.json());
    expect(inboxResult.items).toHaveLength(2);
    const itemId = inboxResult.items[0]?.id;
    if (!itemId) throw new Error('Created authorization item was not returned');
    const detail = await fetch(`${apiUrl}/api/v1/authorization-items/${itemId}`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(detail.status).toBe(200);
    const detailResult = await detail.json() as { item: { sourceData: Record<string, unknown> | null }; importHistory: unknown[] };
    expect(detailResult.item.sourceData?.NUMERO_AUTORIZACION).toBe(authorization);
    expect(typeof detailResult.item.sourceData?.COD_COMERCIAL).toBe('string');
    expect(detailResult.importHistory.length).toBeGreaterThanOrEqual(2);

    const olpInbox = await fetch(`${apiUrl}/api/v1/authorization-items?authorizationKey=${encodeURIComponent(`${authorization}:`)}&limit=25`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    const olpResult = paginatedAuthorizationItemsResponseSchema.parse(await olpInbox.json());
    expect(olpResult.items).toHaveLength(2);
    const olpDetail = await fetch(`${apiUrl}/api/v1/authorization-items/${itemId}`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    expect((await olpDetail.json() as { item: { sourceData: unknown } }).item.sourceData).toBeNull();

    for (const path of [`/api/v1/imports/${batch.id}`, `/api/v1/imports/${batch.id}/rows?limit=25`]) {
      const crossOrganizationBatch = await fetch(`${apiUrl}${path}`, {
        headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
      });
      expect(crossOrganizationBatch.status).toBe(404);
      expect(await crossOrganizationBatch.json()).toMatchObject({ code: 'IMPORT_NOT_FOUND' });
    }
    const crossOrganizationConfirm = await withOlpImportConfirmationPermission(() => fetch(`${apiUrl}/api/v1/imports/${batch.id}/confirm`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${olpToken}`,
          'x-organization-id': olpOrganizationId,
          'idempotency-key': randomUUID(),
          'content-type': 'application/json',
        },
        body: '{}',
      }));
    expect(crossOrganizationConfirm.status).toBe(404);
    expect(await crossOrganizationConfirm.json()).toMatchObject({ code: 'IMPORT_NOT_FOUND' });

    const outbox = await database.query<{ status: string; event_type: string }>(
      `select o.status, o.event_type from outbox_events o where o.payload->>'batchId' = $1`,
      [batch.id],
    );
    expect(outbox.rows).toEqual([{ status: 'PROCESSED', event_type: 'authorization.import' }]);
    const job = await database.query<{ queue: string; job_name: string }>(
      'select queue, job_name from job_results where idempotency_key = (select idempotency_key from outbox_events where payload->>\'batchId\' = $1)',
      [batch.id],
    );
    expect(job.rows).toEqual([{ queue: 'authorization-imports', job_name: 'authorization.import.v1' }]);
    const source = await database.query<{ content_is_null: boolean }>(
      'select content is null as content_is_null from import_source_files where import_batch_id = $1',
      [batch.id],
    );
    expect(source.rows[0]?.content_is_null).toBe(true);
    const audits = await database.query<{ action: string }>(
      `select action from audit_events where resource_id in ($1, $2) and action in ('IMPORT_CREATED', 'AUTHORIZATION_ITEM_CREATED', 'COVERAGE_CLASSIFIED', 'IMPORT_CONFIRMED')`,
      [batch.id, itemId],
    );
    expect(audits.rows.map((entry) => entry.action)).toEqual(expect.arrayContaining(['IMPORT_CREATED', 'AUTHORIZATION_ITEM_CREATED', 'COVERAGE_CLASSIFIED', 'IMPORT_CONFIRMED']));
  });

  it('does not create duplicate items when two batches confirm the same key concurrently', async () => {
    const authorization = `AUTH-CONCURRENT-${randomUUID()}`;
    const content = authorizationCsv([{ authorization, medication: 'MED-CONCURRENT', coverage: 'MEDICAMENTOS POS', status: '5' }]);
    const [first, second] = await Promise.all([createImport(adminToken, content), createImport(adminToken, content)]);
    await Promise.all([waitForBatch(adminToken, first.id), waitForBatch(adminToken, second.id)]);
    const [firstConfirmation, secondConfirmation] = await Promise.all([confirmImport(adminToken, first.id), confirmImport(adminToken, second.id)]);
    expect(firstConfirmation.createdRows + secondConfirmation.createdRows).toBe(1);
    const itemCount = await database.query<{ count: string }>(
      'select count(*)::text as count from authorization_items where numero_autorizacion = $1 and codigo_medicamento = $2',
      [authorization.toUpperCase(), 'MED-CONCURRENT'],
    );
    expect(itemCount.rows[0]?.count).toBe('1');
  });

  it('does not permit an explicit update before READY_TO_DISPENSE', async () => {
    const authorization = `AUTH-UPDATE-${randomUUID()}`;
    const batch = await createImport(adminToken, authorizationCsv([{ authorization, medication: 'MED-UPDATE', coverage: 'MEDICAMENTOS POS', status: '5' }]));
    await waitForBatch(adminToken, batch.id);
    await confirmImport(adminToken, batch.id);
    const rows = await (await fetch(`${apiUrl}/api/v1/imports/${batch.id}/rows?limit=10`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    })).json() as { items: Array<{ id: string; authorizationItemId: string | null }> };
    const row = rows.items[0];
    if (!row?.authorizationItemId) throw new Error('Expected confirmed row to reference an item');
    const response = await fetch(`${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': mtdOrganizationId,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ importRowId: row.id, expectedVersion: 1 }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({ code: 'EXPLICIT_UPDATE_NOT_ALLOWED' });
  });

  it('rejects a source update row owned by another organization even when the item is shared', async () => {
    const authorization = `AUTH-SOURCE-SCOPE-${randomUUID()}`;
    const content = authorizationCsv([{ authorization, medication: 'MED-SOURCE-SCOPE', coverage: 'MEDICAMENTOS POS', status: '5' }]);
    const initialBatch = await createImport(adminToken, content);
    await waitForBatch(adminToken, initialBatch.id);
    await confirmImport(adminToken, initialBatch.id);
    const reviewBatch = await createImport(adminToken, content);
    await waitForBatch(adminToken, reviewBatch.id);
    const rows = await (await fetch(`${apiUrl}/api/v1/imports/${reviewBatch.id}/rows?limit=10`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    })).json() as { items: Array<{ id: string; authorizationItemId: string | null; resultCode: string }> };
    const row = rows.items[0];
    if (!row?.authorizationItemId) throw new Error('Expected review row to reference the shared item');
    expect(row.resultCode).toBe('EXISTING_ITEM_REVIEW_REQUIRED');
    const updated = await database.query<{ version: number }>(
      `update authorization_items set operation_status = 'READY_TO_DISPENSE' where id = $1 returning version`,
      [row.authorizationItemId],
    );
    const response = await withOlpImportConfirmationPermission(() => fetch(`${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${olpToken}`,
          'x-organization-id': olpOrganizationId,
          'idempotency-key': randomUUID(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ importRowId: row.id, expectedVersion: updated.rows[0]?.version }),
      }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SOURCE_UPDATE_ROW_INVALID' });
  });

  it('reuses an expired import creation idempotency key for a new payload', async () => {
    const key = randomUUID();
    const first = await createImport(adminToken, authorizationCsv([{ authorization: `AUTH-IDEM-${randomUUID()}`, medication: 'MED-A', coverage: 'MEDICAMENTOS POS', status: '5' }]), key);
    await database.query(
      `update idempotency_records set expires_at = now() - interval '1 second' where scope = $1 and key = $2`,
      [`imports.create:${mtdOrganizationId}`, key],
    );
    const second = await createImport(adminToken, authorizationCsv([{ authorization: `AUTH-IDEM-${randomUUID()}`, medication: 'MED-B', coverage: 'MEDICAMENTOS POS', status: '5' }]), key);
    expect(second.id).not.toBe(first.id);
  });

  it('rejects multipart filenames longer than 255 characters with a stable error', async () => {
    const form = new FormData();
    form.append('file', new Blob(['a'], { type: 'text/csv' }), `${'a'.repeat(252)}.csv`);
    const response = await fetch(`${apiUrl}/api/v1/imports`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId, 'idempotency-key': randomUUID() },
      body: form,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'IMPORT_FILENAME_TOO_LONG' });
  });

  it('returns stable validation results and derives blocked source status without external calls', async () => {
    const authorization = `AUTH-BLOCKED-${randomUUID()}`;
    const missingHeaderBatch = await createImport(adminToken, 'NUMERO_AUTORIZACION,COD_COMERCIAL\nAUTH-MISSING,MED-MISSING\n');
    const missingReady = await waitForBatch(adminToken, missingHeaderBatch.id);
    expect(missingReady).toMatchObject({ status: 'READY_TO_CONFIRM', totalRows: 1, validRows: 0, rejectedRows: 1 });
    const missingRows = await (await fetch(`${apiUrl}/api/v1/imports/${missingHeaderBatch.id}/rows?limit=10`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    })).json() as { items: Array<{ resultCode: string; validationErrors: Array<{ field: string }> }> };
    expect(missingRows.items[0]).toMatchObject({ resultCode: 'MISSING_REQUIRED_FIELD' });
    expect(missingRows.items[0]?.validationErrors.map((entry) => entry.field)).toEqual(expect.arrayContaining(['CUPS_PRINCIPAL', 'ESTADO_AUTORIZACION']));

    const blockedBatch = await createImport(adminToken, authorizationCsv([{ authorization, medication: 'MED-BLOCKED', coverage: 'MEDICAMENTOS NO POS', status: '4' }]));
    await waitForBatch(adminToken, blockedBatch.id);
    const confirmation = await confirmImport(adminToken, blockedBatch.id);
    expect(confirmation.createdRows).toBe(1);
    const blockedItems = await database.query<{ id: string; enablement_status: string; coverage_type: string; direction_status: string; operation_status: string | null }>(
      'select id, enablement_status, coverage_type, direction_status, operation_status from authorization_items where authorization_key = $1',
      [`${authorization.toUpperCase()}:MED-BLOCKED`],
    );
    expect(blockedItems.rows).toHaveLength(1);
    expect(blockedItems.rows[0]).toMatchObject({ enablement_status: 'BLOCKED_SOURCE_STATUS', coverage_type: 'NO_PBS', direction_status: 'PENDING', operation_status: null });
  });
});
