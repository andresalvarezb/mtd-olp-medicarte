import { createHash, randomUUID } from 'node:crypto';
import { loginDev } from './helpers/auth';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  importBatchResponseSchema,
  paginatedAuthorizationItemsResponseSchema,
  paginatedImportRowsResponseSchema,
  sourceUpdateResponseSchema,
} from '../../packages/contracts/src/index.js';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
let foundationAdminUserId: string;
const olpOperatorRoleId = '20000000-0000-4000-8000-000000000004';
const authorizationsReadSensitivePermissionId = '30000000-0000-4000-8000-000000000003';
const importsCreatePermissionId = '30000000-0000-4000-8000-000000000004';
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

async function login(username: string, password: string): Promise<string> {
  // ADR-026: autenticación local vía POST /auth/login (los operadores de
  // desarrollo se autoaprovisionan con el token administrativo).
  return loginDev(username, password);
}

function csvValue(value: string): string {
  return /[,"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvRow(values: string[]): string {
  return values.map(csvValue).join(',');
}

function jsonEvidenceHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? 'null')
    .digest('hex');
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
        '2026-12-31',
        row.status,
        row.prescripcion,
        'prueba F2',
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

async function createImport(
  token: string,
  content: string,
  key = randomUUID(),
  filename = 'authorizations.csv',
  organizationId = mtdOrganizationId,
): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), filename);
  const response = await fetch(`${apiUrl}/api/v1/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      'idempotency-key': key,
    },
    body: form,
  });
  if (response.status !== 202)
    throw new Error(`Import creation failed: ${response.status} ${await response.text()}`);
  return importBatchResponseSchema.parse(await response.json());
}

async function waitForBatch(
  token: string,
  batchId: string,
  organizationId = mtdOrganizationId,
): Promise<ReturnType<typeof importBatchResponseSchema.parse>> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const result = await database.query<{ status: string }>(
      'select status from import_batches where id = $1',
      [batchId],
    );
    const status = result.rows[0]?.status;
    if (status === 'READY_TO_CONFIRM' || status === 'COMPLETED' || status === 'FAILED') {
      const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}`, {
        headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
      });
      if (response.status !== 200)
        throw new Error(`Import read failed: ${response.status} ${await response.text()}`);
      return importBatchResponseSchema.parse(await response.json());
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Import ${batchId} did not finish validation`);
}

async function confirmImport(
  token: string,
  batchId: string,
  organizationId = mtdOrganizationId,
): Promise<{ status: string; createdRows: number; existingRows: number }> {
  const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (response.status !== 200)
    throw new Error(`Import confirmation failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { status: string; createdRows: number; existingRows: number };
}

async function withOlpPermissions<T>(
  permissionIds: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const inserted = await database.query<{ permission_id: string }>(
    `insert into role_permissions (role_id, permission_id)
     select $1, requested.permission_id
     from unnest($2::uuid[]) as requested(permission_id)
     on conflict do nothing
     returning permission_id`,
    [olpOperatorRoleId, permissionIds],
  );
  try {
    return await operation();
  } finally {
    const insertedPermissionIds = inserted.rows.map((row) => row.permission_id);
    if (insertedPermissionIds.length > 0) {
      await database.query(
        'delete from role_permissions where role_id = $1 and permission_id = any($2::uuid[])',
        [olpOperatorRoleId, insertedPermissionIds],
      );
    }
  }
}

describe('Gate F2', () => {
  beforeAll(async () => {
    await database.connect();
    const admin = await database.query<{ id: string }>('select id from users where username = $1', [
      'foundation-admin',
    ]);
    foundationAdminUserId = admin.rows[0]?.id ?? '';
    if (!foundationAdminUserId) throw new Error('foundation-admin local user missing');
    [adminToken, olpToken] = await Promise.all([
      login('foundation-admin', 'foundation-admin'),
      login('olp-operator', 'olp-operator'),
    ]);
  });

  afterAll(async () => database.end());

  it('processes CSV staging, classifies PBS/NO PBS, confirms transactionally, and preserves traceability', async () => {
    const authorization = `AUTH-F2-${randomUUID()}`;
    const content = authorizationCsv([
      { authorization, medication: 'MED-PBS', prescripcion: '', status: '5' },
      { authorization, medication: 'MED-NO-PBS', prescripcion: '20260915123', status: '5' },
      { authorization, medication: 'MED-NO-PBS', prescripcion: '20260915123', status: '5' },
    ]);
    const batch = await createImport(adminToken, content);
    const ready = await waitForBatch(adminToken, batch.id);
    expect(ready).toMatchObject({
      status: 'READY_TO_CONFIRM',
      totalRows: 3,
      validRows: 2,
      duplicateRows: 1,
      existingRows: 0,
    });

    const rowsResponse = await fetch(`${apiUrl}/api/v1/imports/${batch.id}/rows?limit=100`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(rowsResponse.status).toBe(200);
    const rows = paginatedImportRowsResponseSchema.parse(await rowsResponse.json());
    expect(rows.items.map((row) => row.resultCode)).toEqual([
      'ROW_VALID',
      'ROW_VALID',
      'DUPLICATE_IN_FILE',
    ]);
    expect(rows.items[0]?.normalized).toMatchObject({
      coverageType: 'PBS',
      directionStatus: 'NOT_APPLICABLE',
      enablementStatus: 'ENABLED',
    });
    expect(rows.items[1]?.normalized).toMatchObject({
      coverageType: 'NO_PBS',
      directionStatus: 'PENDING',
      enablementStatus: 'ENABLED',
    });

    const confirmed = await confirmImport(adminToken, batch.id);
    expect(confirmed).toMatchObject({ status: 'COMPLETED', createdRows: 2 });
    const repeatedBatch = await createImport(adminToken, content);
    const repeatedReady = await waitForBatch(adminToken, repeatedBatch.id);
    expect(repeatedReady).toMatchObject({
      status: 'READY_TO_CONFIRM',
      validRows: 0,
      existingRows: 2,
      duplicateRows: 1,
    });
    const repeatedRows = (await (
      await fetch(`${apiUrl}/api/v1/imports/${repeatedBatch.id}/rows?limit=100`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      })
    ).json()) as { items: Array<{ resultCode: string }> };
    expect(repeatedRows.items.map((row) => row.resultCode)).toEqual([
      'EXISTING_ITEM_REVIEW_REQUIRED',
      'EXISTING_ITEM_REVIEW_REQUIRED',
      'DUPLICATE_IN_FILE',
    ]);

    const itemCount = await database.query<{ count: string }>(
      'select count(*)::text as count from authorization_items where numero_autorizacion = $1',
      [authorization.toUpperCase()],
    );
    expect(itemCount.rows[0]?.count).toBe('2');

    const inbox = await fetch(
      `${apiUrl}/api/v1/authorization-items?authorizationKey=${encodeURIComponent(`${authorization}:`)}&limit=25`,
      {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      },
    );
    const inboxResult = paginatedAuthorizationItemsResponseSchema.parse(await inbox.json());
    expect(inboxResult.items).toHaveLength(2);
    const itemId = inboxResult.items[0]?.id;
    if (!itemId) throw new Error('Created authorization item was not returned');
    const detail = await fetch(`${apiUrl}/api/v1/authorization-items/${itemId}`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(detail.status).toBe(200);
    const detailResult = (await detail.json()) as {
      item: { sourceData: Record<string, unknown> | null };
      importHistory: unknown[];
    };
    expect(detailResult.item.sourceData?.NUMERO_AUTORIZACION).toBe(authorization);
    expect(typeof detailResult.item.sourceData?.COD_COMERCIAL).toBe('string');
    expect(detailResult.importHistory.length).toBeGreaterThanOrEqual(2);

    const olpInbox = await fetch(
      `${apiUrl}/api/v1/authorization-items?authorizationKey=${encodeURIComponent(`${authorization}:`)}&limit=25`,
      {
        headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
      },
    );
    const olpResult = paginatedAuthorizationItemsResponseSchema.parse(await olpInbox.json());
    expect(olpResult.items).toHaveLength(2);
    const olpDetail = await fetch(`${apiUrl}/api/v1/authorization-items/${itemId}`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    const olpDetailResult = (await olpDetail.json()) as {
      item: { sourceData: Record<string, unknown> | null };
    };
    expect(olpDetailResult.item.sourceData).not.toBeNull();
    expect(olpDetailResult.item.sourceData?.NUMERO_AUTORIZACION).toBe(authorization);

    for (const path of [
      `/api/v1/imports/${batch.id}`,
      `/api/v1/imports/${batch.id}/rows?limit=25`,
    ]) {
      const crossOrganizationBatch = await fetch(`${apiUrl}${path}`, {
        headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
      });
      expect(crossOrganizationBatch.status).toBe(404);
      expect(await crossOrganizationBatch.json()).toMatchObject({ code: 'IMPORT_NOT_FOUND' });
    }
    const crossOrganizationConfirm = await withOlpPermissions([importsConfirmPermissionId], () =>
      fetch(`${apiUrl}/api/v1/imports/${batch.id}/confirm`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${olpToken}`,
          'x-organization-id': olpOrganizationId,
          'idempotency-key': randomUUID(),
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    );
    expect(crossOrganizationConfirm.status).toBe(404);
    expect(await crossOrganizationConfirm.json()).toMatchObject({ code: 'IMPORT_NOT_FOUND' });

    const outbox = await database.query<{ status: string; event_type: string }>(
      `select o.status, o.event_type from outbox_events o where o.payload->>'batchId' = $1`,
      [batch.id],
    );
    expect(outbox.rows).toEqual([{ status: 'PROCESSED', event_type: 'authorization.import' }]);
    const job = await database.query<{ queue: string; job_name: string }>(
      "select queue, job_name from job_results where idempotency_key = (select idempotency_key from outbox_events where payload->>'batchId' = $1)",
      [batch.id],
    );
    expect(job.rows).toEqual([
      { queue: 'authorization-imports', job_name: 'authorization.import.v1' },
    ]);
    const source = await database.query<{ content_is_null: boolean }>(
      'select content is null as content_is_null from import_source_files where import_batch_id = $1',
      [batch.id],
    );
    expect(source.rows[0]?.content_is_null).toBe(true);
    const audits = await database.query<{ action: string }>(
      `select action from audit_events where resource_id in ($1, $2) and action in ('IMPORT_CREATED', 'AUTHORIZATION_ITEM_CREATED', 'COVERAGE_CLASSIFIED', 'IMPORT_CONFIRMED')`,
      [batch.id, itemId],
    );
    expect(audits.rows.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'IMPORT_CREATED',
        'AUTHORIZATION_ITEM_CREATED',
        'COVERAGE_CLASSIFIED',
        'IMPORT_CONFIRMED',
      ]),
    );
  });

  it('derives no_prescripcion for MIPRES and rejects invalid prescripcion formats', async () => {
    const authorization = `AUTH-PRES-${randomUUID()}`;
    const batch = await createImport(
      adminToken,
      authorizationCsv([
        { authorization, medication: 'MED-PRES-PBS', prescripcion: '', status: '5' },
        {
          authorization,
          medication: 'MED-PRES-NO-PBS',
          prescripcion: ' 20260915123 ',
          status: '5',
        },
        { authorization, medication: 'MED-PRES-INVALID', prescripcion: '123', status: '5' },
      ]),
    );
    await waitForBatch(adminToken, batch.id);
    const ready = await waitForBatch(adminToken, batch.id);
    expect(ready).toMatchObject({
      status: 'READY_TO_CONFIRM',
      totalRows: 3,
      validRows: 2,
      rejectedRows: 1,
    });
    const rows = (await (
      await fetch(`${apiUrl}/api/v1/imports/${batch.id}/rows?limit=10`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      })
    ).json()) as {
      items: Array<{
        resultCode: string;
        normalized: { noPrescripcion: string } | null;
        validationErrors: Array<{ field: string; code: string }>;
      }>;
    };
    expect(rows.items[0]?.normalized).toMatchObject({ noPrescripcion: '' });
    expect(rows.items[1]?.normalized).toMatchObject({ noPrescripcion: '20260915' });
    expect(rows.items[2]).toMatchObject({ resultCode: 'INVALID_FIELD_FORMAT' });
    expect(rows.items[2]?.validationErrors[0]).toMatchObject({
      field: 'No.PRESCRIPCION',
      code: 'INVALID_FIELD_FORMAT',
    });

    const confirmation = await confirmImport(adminToken, batch.id);
    expect(confirmation.createdRows).toBe(2);
    const items = await database.query<{
      codigo_medicamento: string;
      source_prescripcion_normalized: string;
      no_prescripcion: string;
      coverage_type: string;
      direction_status: string;
      coverage_rule_version: string;
    }>(
      `select codigo_medicamento, source_prescripcion_normalized, no_prescripcion, coverage_type,
              direction_status, coverage_rule_version
       from authorization_items
       where numero_autorizacion = $1
       order by codigo_medicamento`,
      [authorization.toUpperCase()],
    );
    expect(items.rows).toEqual([
      {
        codigo_medicamento: 'MED-PRES-NO-PBS',
        source_prescripcion_normalized: '20260915123',
        no_prescripcion: '20260915',
        coverage_type: 'NO_PBS',
        direction_status: 'PENDING',
        coverage_rule_version: 'F2-COVERAGE-2',
      },
      {
        codigo_medicamento: 'MED-PRES-PBS',
        source_prescripcion_normalized: '',
        no_prescripcion: '',
        coverage_type: 'PBS',
        direction_status: 'NOT_APPLICABLE',
        coverage_rule_version: 'F2-COVERAGE-2',
      },
    ]);
  });

  it('does not create duplicate items when two batches confirm the same key concurrently', async () => {
    const authorization = `AUTH-CONCURRENT-${randomUUID()}`;
    const content = authorizationCsv([
      { authorization, medication: 'MED-CONCURRENT', prescripcion: '', status: '5' },
    ]);
    const [first, second] = await Promise.all([
      createImport(adminToken, content),
      createImport(adminToken, content),
    ]);
    await Promise.all([waitForBatch(adminToken, first.id), waitForBatch(adminToken, second.id)]);
    const [firstConfirmation, secondConfirmation] = await Promise.all([
      confirmImport(adminToken, first.id),
      confirmImport(adminToken, second.id),
    ]);
    expect(firstConfirmation.createdRows + secondConfirmation.createdRows).toBe(1);
    const itemCount = await database.query<{ count: string }>(
      'select count(*)::text as count from authorization_items where numero_autorizacion = $1 and codigo_medicamento = $2',
      [authorization.toUpperCase(), 'MED-CONCURRENT'],
    );
    expect(itemCount.rows[0]?.count).toBe('1');
  });

  it('does not permit an explicit update before READY_TO_DISPENSE', async () => {
    // Fase 4 materializa operation_status en la confirmación: un ítem NO PBS
    // habilitado queda BLOCKED (direccionamiento pendiente) y no admite la
    // actualización explícita de evidencia (DEC-002/ADR-021).
    const authorization = `AUTH-UPDATE-${randomUUID()}`;
    const batch = await createImport(
      adminToken,
      authorizationCsv([
        { authorization, medication: 'MED-UPDATE', prescripcion: '20260915123000', status: '5' },
      ]),
    );
    await waitForBatch(adminToken, batch.id);
    await confirmImport(adminToken, batch.id);
    const rows = (await (
      await fetch(`${apiUrl}/api/v1/imports/${batch.id}/rows?limit=10`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      })
    ).json()) as { items: Array<{ id: string; authorizationItemId: string | null }> };
    const row = rows.items[0];
    if (!row?.authorizationItemId) throw new Error('Expected confirmed row to reference an item');
    const response = await fetch(
      `${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'x-organization-id': mtdOrganizationId,
          'idempotency-key': randomUUID(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ importRowId: row.id, expectedVersion: 1 }),
      },
    );
    expect(response.status).toBe(409);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'EXPLICIT_UPDATE_NOT_ALLOWED',
    });
  });

  it('recalculates operation status after an explicit source update', async () => {
    const cases = [
      {
        name: 'keeps a PBS item ready',
        prescripcion: '',
        status: '5',
        expectedOperationStatus: 'READY_TO_DISPENSE',
        expectedEnablementStatus: 'ENABLED',
        expectedCoverageType: 'PBS',
        expectedDirectionStatus: 'NOT_APPLICABLE',
        expectedNoPrescripcion: '',
      },
      {
        name: 'blocks an item with a blocked source status',
        prescripcion: '',
        status: '4',
        expectedOperationStatus: 'BLOCKED',
        expectedEnablementStatus: 'BLOCKED_SOURCE_STATUS',
        expectedCoverageType: 'PBS',
        expectedDirectionStatus: 'NOT_APPLICABLE',
        expectedNoPrescripcion: '',
      },
      {
        name: 'blocks a NO_PBS item pending MIPRES',
        prescripcion: '20260915123',
        status: '5',
        expectedOperationStatus: 'BLOCKED',
        expectedEnablementStatus: 'ENABLED',
        expectedCoverageType: 'NO_PBS',
        expectedDirectionStatus: 'PENDING',
        expectedNoPrescripcion: '20260915',
      },
    ] as const;

    for (const testCase of cases) {
      const authorization = `AUTH-UPDATE-STATUS-${testCase.name}-${randomUUID()}`;
      const initialBatch = await createImport(
        adminToken,
        authorizationCsv([
          {
            authorization,
            medication: 'MED-UPDATE-STATUS',
            prescripcion: '',
            status: '5',
          },
        ]),
      );
      await waitForBatch(adminToken, initialBatch.id);
      await confirmImport(adminToken, initialBatch.id);
      const initialEvidence = await database.query<{ id: string; raw_data: unknown }>(
        `select id, raw_data from import_rows
         where import_batch_id = $1 and result_code = 'ITEM_CREATED'`,
        [initialBatch.id],
      );
      const initialEvidenceRowId = initialEvidence.rows[0]?.id;
      if (!initialEvidenceRowId) throw new Error(`Expected initial evidence for ${testCase.name}`);
      const initialEvidenceHash = jsonEvidenceHash(initialEvidence.rows[0]?.raw_data);

      const reviewBatch = await createImport(
        adminToken,
        authorizationCsv([
          {
            authorization,
            medication: 'MED-UPDATE-STATUS',
            prescripcion: testCase.prescripcion,
            status: testCase.status,
          },
        ]),
      );
      await waitForBatch(adminToken, reviewBatch.id);
      const rows = (await (
        await fetch(`${apiUrl}/api/v1/imports/${reviewBatch.id}/rows?limit=10`, {
          headers: {
            authorization: `Bearer ${adminToken}`,
            'x-organization-id': mtdOrganizationId,
          },
        })
      ).json()) as {
        items: Array<{ id: string; authorizationItemId: string | null; resultCode: string }>;
      };
      const row = rows.items[0];
      if (!row?.authorizationItemId) throw new Error(`Expected update row for ${testCase.name}`);
      expect(row.resultCode).toBe('EXISTING_ITEM_REVIEW_REQUIRED');

      const ready = await database.query<{ version: number }>(
        `update authorization_items
         set operation_status = 'READY_TO_DISPENSE'
         where id = $1
         returning version`,
        [row.authorizationItemId],
      );
      const expectedVersion = ready.rows[0]?.version;
      if (!expectedVersion) throw new Error(`Expected item version for ${testCase.name}`);

      const idempotencyKey = randomUUID();
      const response = await fetch(
        `${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'x-organization-id': mtdOrganizationId,
            'idempotency-key': idempotencyKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ importRowId: row.id, expectedVersion }),
        },
      );
      expect(response.status).toBe(200);
      const updated = sourceUpdateResponseSchema.parse(await response.json());
      expect(updated.item).toMatchObject({
        operationStatus: testCase.expectedOperationStatus,
        enablementStatus: testCase.expectedEnablementStatus,
        coverageType: testCase.expectedCoverageType,
        directionStatus: testCase.expectedDirectionStatus,
      });

      const replay = await fetch(
        `${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'x-organization-id': mtdOrganizationId,
            'idempotency-key': idempotencyKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ importRowId: row.id, expectedVersion }),
        },
      );
      expect(replay.status).toBe(200);
      expect(sourceUpdateResponseSchema.parse(await replay.json())).toEqual(updated);

      const stored = await database.query<{
        operation_status: string;
        enablement_status: string;
        coverage_type: string;
        direction_status: string;
      }>(
        `select operation_status, enablement_status, coverage_type, direction_status
         from authorization_items
         where id = $1`,
        [row.authorizationItemId],
      );
      expect(stored.rows[0]).toEqual({
        operation_status: testCase.expectedOperationStatus,
        enablement_status: testCase.expectedEnablementStatus,
        coverage_type: testCase.expectedCoverageType,
        direction_status: testCase.expectedDirectionStatus,
      });

      const idempotencyScope = `authorization-items.update:${mtdOrganizationId}:${row.authorizationItemId}`;
      const idempotency = await database.query<{
        id: string;
        request_hash: string;
        response: { item: { sourceData: unknown } };
      }>(
        `select id, request_hash, response
         from idempotency_records
         where scope = $1 and key = $2`,
        [idempotencyScope, idempotencyKey],
      );
      const idempotencyRecord = idempotency.rows[0];
      if (!idempotencyRecord) throw new Error(`Expected idempotency record for ${testCase.name}`);
      const requestHash = createHash('sha256').update(`${row.id}:${expectedVersion}`).digest('hex');
      const keyHash = createHash('sha256').update(idempotencyKey).digest('hex');
      expect(idempotencyRecord.request_hash).toBe(requestHash);
      expect(idempotencyRecord.response.item.sourceData).toBeNull();
      expect(JSON.stringify(idempotencyRecord.response)).not.toContain('Paciente de prueba');

      const newEvidence = await database.query<{ raw_data: unknown }>(
        'select raw_data from import_rows where id = $1',
        [row.id],
      );
      const newEvidenceHash = jsonEvidenceHash(newEvidence.rows[0]?.raw_data);

      type AuditState = {
        version: number;
        authorizationKey: string;
        numeroAutorizacionNormalized: string;
        codigoComercialNormalized: string;
        sourceEvidence: { importRowId: string | null; sha256: string };
        sourceStatusNormalized: string;
        sourcePrescripcionNormalized: string;
        noPrescripcion: string;
        enablementStatus: string;
        coverageType: string;
        directionStatus: string;
        operationStatus: string;
        coverageRuleVersion: string;
      };
      const audits = await database.query<{
        actor_id: string;
        organization_id: string;
        occurred_at: Date;
        correlation_id: string;
        request_id: string;
        before: AuditState;
        after: AuditState & {
          idempotency: { recordId: string; scope: string; requestHash: string; keyHash: string };
        };
      }>(
        `select actor_id, organization_id, occurred_at, correlation_id, request_id, before, after
         from audit_events
         where action = 'AUTHORIZATION_ITEM_UPDATED' and resource_id = $1
         order by occurred_at desc`,
        [row.authorizationItemId],
      );
      expect(audits.rows).toHaveLength(1);
      const audit = audits.rows[0];
      if (!audit) throw new Error(`Expected update audit for ${testCase.name}`);
      expect(audit).toMatchObject({
        actor_id: foundationAdminUserId,
        organization_id: mtdOrganizationId,
      });
      expect(audit.occurred_at).toBeInstanceOf(Date);
      expect(audit.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(audit.request_id).toBe(audit.correlation_id);
      expect(audit.before).toMatchObject({
        version: expectedVersion,
        authorizationKey: updated.item.authorizationKey,
        numeroAutorizacionNormalized: updated.item.numeroAutorizacion,
        codigoComercialNormalized: updated.item.codigoMedicamento,
        sourceEvidence: {
          importRowId: initialEvidenceRowId,
          sha256: initialEvidenceHash,
        },
        sourceStatusNormalized: '5',
        sourcePrescripcionNormalized: '',
        noPrescripcion: '',
        enablementStatus: 'ENABLED',
        coverageType: 'PBS',
        directionStatus: 'NOT_APPLICABLE',
        operationStatus: 'READY_TO_DISPENSE',
        coverageRuleVersion: 'F2-COVERAGE-2',
      });
      expect(audit.after).toMatchObject({
        version: expectedVersion + 1,
        authorizationKey: updated.item.authorizationKey,
        numeroAutorizacionNormalized: updated.item.numeroAutorizacion,
        codigoComercialNormalized: updated.item.codigoMedicamento,
        sourceEvidence: {
          importRowId: row.id,
          sha256: newEvidenceHash,
        },
        sourceStatusNormalized: testCase.status,
        sourcePrescripcionNormalized: testCase.prescripcion,
        noPrescripcion: testCase.expectedNoPrescripcion,
        enablementStatus: testCase.expectedEnablementStatus,
        coverageType: testCase.expectedCoverageType,
        directionStatus: testCase.expectedDirectionStatus,
        operationStatus: testCase.expectedOperationStatus,
        coverageRuleVersion: 'F2-COVERAGE-2',
        idempotency: {
          recordId: idempotencyRecord.id,
          scope: idempotencyScope,
          requestHash,
          keyHash,
        },
      });
      expect(JSON.stringify(audit)).not.toContain('Paciente de prueba');

      if (testCase.expectedOperationStatus === 'BLOCKED') {
        await expect(
          database.query(
            `update authorization_items
             set operation_status = 'READY_TO_DISPENSE'
             where id = $1`,
            [row.authorizationItemId],
          ),
        ).rejects.toThrow('authorization_items_ready_prerequisites_check');
      }
    }
  });

  it('rolls back the complete source update when audit persistence fails', async () => {
    const authorization = `AUTH-UPDATE-ROLLBACK-${randomUUID()}`;
    const content = authorizationCsv([
      {
        authorization,
        medication: 'MED-UPDATE-ROLLBACK',
        prescripcion: '',
        status: '5',
      },
    ]);
    const initialBatch = await createImport(adminToken, content);
    await waitForBatch(adminToken, initialBatch.id);
    await confirmImport(adminToken, initialBatch.id);
    const reviewBatch = await createImport(adminToken, content);
    await waitForBatch(adminToken, reviewBatch.id);
    const rows = (await (
      await fetch(`${apiUrl}/api/v1/imports/${reviewBatch.id}/rows?limit=10`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      })
    ).json()) as {
      items: Array<{ id: string; authorizationItemId: string | null; resultCode: string }>;
    };
    const row = rows.items[0];
    if (!row?.authorizationItemId) throw new Error('Expected rollback update row');
    const ready = await database.query<{ version: number }>(
      `update authorization_items
       set operation_status = 'READY_TO_DISPENSE'
       where id = $1
       returning version`,
      [row.authorizationItemId],
    );
    const expectedVersion = ready.rows[0]?.version;
    if (!expectedVersion) throw new Error('Expected rollback item version');
    const baseline = await database.query<{
      version: number;
      source_data: unknown;
      coverage_type: string;
      enablement_status: string;
      direction_status: string;
      operation_status: string;
    }>(
      `select version, source_data, coverage_type, enablement_status, direction_status, operation_status
       from authorization_items where id = $1`,
      [row.authorizationItemId],
    );
    const idempotencyKey = randomUUID();

    await database.query('drop trigger if exists test_reject_update_audit on audit_events');
    await database.query('drop function if exists test_reject_update_audit()');
    await database.query(`
      create function test_reject_update_audit() returns trigger language plpgsql as $$
      begin
        if new.action = 'AUTHORIZATION_ITEM_UPDATED' and new.resource_id = '${row.authorizationItemId}' then
          raise exception 'forced audit failure';
        end if;
        return new;
      end
      $$
    `);
    await database.query(`
      create trigger test_reject_update_audit
      before insert on audit_events
      for each row execute function test_reject_update_audit()
    `);
    try {
      const response = await fetch(
        `${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'x-organization-id': mtdOrganizationId,
            'idempotency-key': idempotencyKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ importRowId: row.id, expectedVersion }),
        },
      );
      expect(response.status).toBe(500);
    } finally {
      await database.query('drop trigger if exists test_reject_update_audit on audit_events');
      await database.query('drop function if exists test_reject_update_audit()');
    }

    const itemAfterFailure = await database.query(
      `select version, source_data, coverage_type, enablement_status, direction_status, operation_status
       from authorization_items where id = $1`,
      [row.authorizationItemId],
    );
    expect(itemAfterFailure.rows).toEqual(baseline.rows);
    const rowAfterFailure = await database.query<{
      result_code: string;
      confirmable: boolean;
    }>('select result_code, confirmable from import_rows where id = $1', [row.id]);
    expect(rowAfterFailure.rows[0]).toEqual({
      result_code: 'EXISTING_ITEM_REVIEW_REQUIRED',
      confirmable: false,
    });
    const partialEffects = await database.query<{
      evaluations: string;
      idempotency_records: string;
      audits: string;
    }>(
      `select
         (select count(*)::text from coverage_evaluations where authorization_item_id = $1 and evaluation_version = $2) as evaluations,
         (select count(*)::text from idempotency_records where scope = $3 and key = $4) as idempotency_records,
         (select count(*)::text from audit_events where action = 'AUTHORIZATION_ITEM_UPDATED' and resource_id = $1::text) as audits`,
      [
        row.authorizationItemId,
        expectedVersion + 1,
        `authorization-items.update:${mtdOrganizationId}:${row.authorizationItemId}`,
        idempotencyKey,
      ],
    );
    expect(partialEffects.rows[0]).toEqual({
      evaluations: '0',
      idempotency_records: '0',
      audits: '0',
    });
  });

  it('revalidates current sensitive permission and organization scope on source update replay', async () => {
    await withOlpPermissions(
      [
        importsCreatePermissionId,
        importsConfirmPermissionId,
        authorizationsReadSensitivePermissionId,
      ],
      async () => {
        const authorization = `AUTH-REPLAY-SCOPE-${randomUUID()}`;
        const content = authorizationCsv([
          {
            authorization,
            medication: 'MED-REPLAY-SCOPE',
            prescripcion: '',
            status: '5',
          },
        ]);
        const initialBatch = await createImport(
          olpToken,
          content,
          randomUUID(),
          'authorizations.csv',
          olpOrganizationId,
        );
        await waitForBatch(olpToken, initialBatch.id, olpOrganizationId);
        await confirmImport(olpToken, initialBatch.id, olpOrganizationId);
        const reviewBatch = await createImport(
          olpToken,
          content,
          randomUUID(),
          'authorizations.csv',
          olpOrganizationId,
        );
        await waitForBatch(olpToken, reviewBatch.id, olpOrganizationId);
        const rows = (await (
          await fetch(`${apiUrl}/api/v1/imports/${reviewBatch.id}/rows?limit=10`, {
            headers: {
              authorization: `Bearer ${olpToken}`,
              'x-organization-id': olpOrganizationId,
            },
          })
        ).json()) as {
          items: Array<{ id: string; authorizationItemId: string | null; resultCode: string }>;
        };
        const row = rows.items[0];
        if (!row?.authorizationItemId) throw new Error('Expected OLP update row');
        expect(row.resultCode).toBe('EXISTING_ITEM_REVIEW_REQUIRED');
        const ready = await database.query<{ version: number }>(
          `update authorization_items
           set operation_status = 'READY_TO_DISPENSE'
           where id = $1
           returning version`,
          [row.authorizationItemId],
        );
        const expectedVersion = ready.rows[0]?.version;
        if (!expectedVersion) throw new Error('Expected OLP item version');
        const idempotencyKey = randomUUID();
        const requestUpdate = () =>
          fetch(`${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${olpToken}`,
              'x-organization-id': olpOrganizationId,
              'idempotency-key': idempotencyKey,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ importRowId: row.id, expectedVersion }),
          });

        await database.query(
          'delete from role_permissions where role_id = $1 and permission_id = $2',
          [olpOperatorRoleId, authorizationsReadSensitivePermissionId],
        );
        const initial = await requestUpdate();
        expect(initial.status).toBe(200);
        expect(sourceUpdateResponseSchema.parse(await initial.json()).item.sourceData).toBeNull();

        await database.query(
          `insert into role_permissions (role_id, permission_id)
           values ($1, $2)
           on conflict do nothing`,
          [olpOperatorRoleId, authorizationsReadSensitivePermissionId],
        );
        const sensitiveReplay = await requestUpdate();
        expect(sensitiveReplay.status).toBe(200);
        expect(
          sourceUpdateResponseSchema.parse(await sensitiveReplay.json()).item.sourceData,
        ).toMatchObject({ NUMERO_AUTORIZACION: authorization });
        const sensitiveReadAudits = await database.query<{ count: string }>(
          `select count(*)::text as count
           from audit_events
           where action = 'AUTHORIZATION_ITEM_READ_SENSITIVE' and resource_id = $1`,
          [row.authorizationItemId],
        );
        expect(sensitiveReadAudits.rows[0]?.count).toBe('1');

        await database.query(
          'delete from role_permissions where role_id = $1 and permission_id = $2',
          [olpOperatorRoleId, authorizationsReadSensitivePermissionId],
        );
        const redactedReplay = await requestUpdate();
        expect(redactedReplay.status).toBe(200);
        expect(
          sourceUpdateResponseSchema.parse(await redactedReplay.json()).item.sourceData,
        ).toBeNull();

        const itemLock = new Client({ connectionString: databaseUrl });
        const permissionRevocation = new Client({ connectionString: databaseUrl });
        await Promise.all([itemLock.connect(), permissionRevocation.connect()]);
        let concurrentReplay: Promise<Response> | undefined;
        let revocation: Promise<unknown> | undefined;
        try {
          await itemLock.query('begin');
          await itemLock.query('select id from authorization_items where id = $1 for update', [
            row.authorizationItemId,
          ]);
          concurrentReplay = requestUpdate();
          const waitDeadline = Date.now() + 5_000;
          let replayWaitingForItem = false;
          while (Date.now() < waitDeadline) {
            const waiting = await database.query<{ waiting: boolean }>(
              `select exists (
                 select 1 from pg_stat_activity
                 where wait_event_type = 'Lock'
                   and query like '%from authorization_items i%'
                   and query like '%for update%'
               ) as waiting`,
            );
            if (waiting.rows[0]?.waiting) {
              replayWaitingForItem = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          expect(replayWaitingForItem).toBe(true);

          revocation = permissionRevocation.query(
            'delete from role_permissions where role_id = $1 and permission_id = $2',
            [olpOperatorRoleId, importsConfirmPermissionId],
          );
          const revokedBeforeReplayCommit = await Promise.race([
            revocation.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 150)),
          ]);
          expect(revokedBeforeReplayCommit).toBe(false);

          await itemLock.query('commit');
          const serializedReplay = await concurrentReplay;
          expect(serializedReplay.status).toBe(200);
          expect(
            sourceUpdateResponseSchema.parse(await serializedReplay.json()).item.sourceData,
          ).toBeNull();
          await revocation;
        } finally {
          await itemLock.query('rollback').catch(() => undefined);
          await revocation?.catch(() => undefined);
          await concurrentReplay?.catch(() => undefined);
          await Promise.all([itemLock.end(), permissionRevocation.end()]);
          await database.query(
            `insert into role_permissions (role_id, permission_id)
             values ($1, $2), ($1, $3)
             on conflict do nothing`,
            [
              olpOperatorRoleId,
              importsConfirmPermissionId,
              authorizationsReadSensitivePermissionId,
            ],
          );
        }

        await database.query(
          `delete from authorization_item_organizations
           where authorization_item_id = $1 and organization_id = $2`,
          [row.authorizationItemId, olpOrganizationId],
        );
        try {
          const deniedReplay = await requestUpdate();
          expect(deniedReplay.status).toBe(404);
          expect(await deniedReplay.json()).toMatchObject({ code: 'AUTHORIZATION_ITEM_NOT_FOUND' });
        } finally {
          await database.query(
            `insert into authorization_item_organizations (authorization_item_id, organization_id)
             values ($1, $2)
             on conflict do nothing`,
            [row.authorizationItemId, olpOrganizationId],
          );
        }
      },
    );
  });

  it('rejects a source update row owned by another organization even when the item is shared', async () => {
    const authorization = `AUTH-SOURCE-SCOPE-${randomUUID()}`;
    const content = authorizationCsv([
      { authorization, medication: 'MED-SOURCE-SCOPE', prescripcion: '', status: '5' },
    ]);
    const initialBatch = await createImport(adminToken, content);
    await waitForBatch(adminToken, initialBatch.id);
    await confirmImport(adminToken, initialBatch.id);
    const reviewBatch = await createImport(adminToken, content);
    await waitForBatch(adminToken, reviewBatch.id);
    const rows = (await (
      await fetch(`${apiUrl}/api/v1/imports/${reviewBatch.id}/rows?limit=10`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      })
    ).json()) as {
      items: Array<{ id: string; authorizationItemId: string | null; resultCode: string }>;
    };
    const row = rows.items[0];
    if (!row?.authorizationItemId)
      throw new Error('Expected review row to reference the shared item');
    expect(row.resultCode).toBe('EXISTING_ITEM_REVIEW_REQUIRED');
    const updated = await database.query<{ version: number }>(
      `update authorization_items set operation_status = 'READY_TO_DISPENSE' where id = $1 returning version`,
      [row.authorizationItemId],
    );
    const response = await withOlpPermissions([importsConfirmPermissionId], () =>
      fetch(`${apiUrl}/api/v1/authorization-items/${row.authorizationItemId}/source-updates`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${olpToken}`,
          'x-organization-id': olpOrganizationId,
          'idempotency-key': randomUUID(),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ importRowId: row.id, expectedVersion: updated.rows[0]?.version }),
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SOURCE_UPDATE_ROW_INVALID' });
  });

  it('reuses an expired import creation idempotency key for a new payload', async () => {
    const key = randomUUID();
    const first = await createImport(
      adminToken,
      authorizationCsv([
        {
          authorization: `AUTH-IDEM-${randomUUID()}`,
          medication: 'MED-A',
          prescripcion: '',
          status: '5',
        },
      ]),
      key,
    );
    await database.query(
      `update idempotency_records set expires_at = now() - interval '1 second' where scope = $1 and key = $2`,
      [`imports.create:${mtdOrganizationId}`, key],
    );
    const second = await createImport(
      adminToken,
      authorizationCsv([
        {
          authorization: `AUTH-IDEM-${randomUUID()}`,
          medication: 'MED-B',
          prescripcion: '',
          status: '5',
        },
      ]),
      key,
    );
    expect(second.id).not.toBe(first.id);
  });

  it('rejects multipart filenames longer than 255 characters with a stable error', async () => {
    const form = new FormData();
    form.append('file', new Blob(['a'], { type: 'text/csv' }), `${'a'.repeat(252)}.csv`);
    const response = await fetch(`${apiUrl}/api/v1/imports`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': mtdOrganizationId,
        'idempotency-key': randomUUID(),
      },
      body: form,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'IMPORT_FILENAME_TOO_LONG' });
  });

  it('returns stable validation results and derives blocked source status without external calls', async () => {
    const authorization = `AUTH-BLOCKED-${randomUUID()}`;
    const missingHeaderBatch = await createImport(
      adminToken,
      'NUMERO_AUTORIZACION,COD_COMERCIAL\nAUTH-MISSING,MED-MISSING\n',
    );
    const missingReady = await waitForBatch(adminToken, missingHeaderBatch.id);
    expect(missingReady).toMatchObject({
      status: 'READY_TO_CONFIRM',
      totalRows: 1,
      validRows: 0,
      rejectedRows: 1,
    });
    const missingRows = (await (
      await fetch(`${apiUrl}/api/v1/imports/${missingHeaderBatch.id}/rows?limit=10`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      })
    ).json()) as {
      items: Array<{ resultCode: string; validationErrors: Array<{ field: string }> }>;
    };
    expect(missingRows.items[0]).toMatchObject({ resultCode: 'MISSING_REQUIRED_FIELD' });
    expect(missingRows.items[0]?.validationErrors.map((entry) => entry.field)).toEqual(
      expect.arrayContaining(['No.PRESCRIPCION', 'ESTADO_AUTORIZACION']),
    );

    const blockedBatch = await createImport(
      adminToken,
      authorizationCsv([
        { authorization, medication: 'MED-BLOCKED', prescripcion: '20260915123', status: '4' },
      ]),
    );
    await waitForBatch(adminToken, blockedBatch.id);
    const confirmation = await confirmImport(adminToken, blockedBatch.id);
    expect(confirmation.createdRows).toBe(1);
    const blockedItems = await database.query<{
      id: string;
      enablement_status: string;
      coverage_type: string;
      direction_status: string;
      operation_status: string | null;
    }>(
      'select id, enablement_status, coverage_type, direction_status, operation_status from authorization_items where authorization_key = $1',
      [`${authorization.toUpperCase()}:MED-BLOCKED`],
    );
    expect(blockedItems.rows).toHaveLength(1);
    expect(blockedItems.rows[0]).toMatchObject({
      enablement_status: 'BLOCKED_SOURCE_STATUS',
      coverage_type: 'NO_PBS',
      direction_status: 'PENDING',
      operation_status: 'BLOCKED',
    });
  });
});
