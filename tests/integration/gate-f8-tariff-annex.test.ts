import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginDev } from './helpers/auth';
import { registerTariffProducts } from './helpers/tariff';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
const medicarteOrganizationId = '10000000-0000-4000-8000-000000000004';

const database = new Client({ connectionString: databaseUrl });
let adminToken: string;
let olpToken: string;
let medicarteToken: string;

const sourceColumns = [
  'NUMERO_AUTORIZACION',
  'COD_COMERCIAL',
  'ESTADO_AUTORIZACION',
  'No.PRESCRIPCION',
  'FECHA_FINAL_VIGENCIA',
];

function csvValue(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function authorizationCsv(input: {
  authorization: string;
  medication: string;
  prescription?: string;
  status?: string;
  vigencia?: string;
}): string {
  return [
    sourceColumns.join(','),
    [
      input.authorization,
      input.medication,
      input.status ?? '5',
      input.prescription ?? '',
      input.vigencia ?? '2099-12-31',
    ]
      .map(csvValue)
      .join(','),
    '',
  ].join('\n');
}

async function createAuthorizationImport(content: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), 'authorization.csv');
  const response = await fetch(`${apiUrl}/api/v1/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  expect(response.status).toBe(202);
  return (await response.json()) as { id: string };
}

async function waitForAuthorizationImport(batchId: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    const batch = (await response.json()) as { status: string };
    if (batch.status === 'READY_TO_CONFIRM') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Authorization import never became ready');
}

async function confirmAuthorizationImport(batchId: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
  expect(response.status).toBe(200);
}

async function waitForItem(authorizationKey: string): Promise<{
  id: string;
  operationStatus: string | null;
  tariffMembershipStatus: string;
  directionStatus: string;
}> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await database.query<{
      id: string;
      operation_status: string | null;
      tariff_membership_status: string;
      direction_status: string;
    }>(
      `select id, operation_status, tariff_membership_status, direction_status
       from authorization_items where authorization_key = $1`,
      [authorizationKey],
    );
    const item = result.rows[0];
    if (item) {
      return {
        id: item.id,
        operationStatus: item.operation_status,
        tariffMembershipStatus: item.tariff_membership_status,
        directionStatus: item.direction_status,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Authorization item not found: ${authorizationKey}`);
}

async function waitForReady(itemId: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await database.query<{ operation_status: string | null }>(
      'select operation_status from authorization_items where id = $1',
      [itemId],
    );
    if (result.rows[0]?.operation_status === 'READY_TO_DISPENSE') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Item never became READY_TO_DISPENSE: ${itemId}`);
}

async function createTariffProduct(code: string): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/admin/tariff-annex/products`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ codigoProducto: code }),
  });
}

describe('Gate F8 — Anexo Tarifario', () => {
  beforeAll(async () => {
    await database.connect();
    [adminToken, olpToken, medicarteToken] = await Promise.all([
      loginDev('foundation-admin', 'foundation-admin'),
      loginDev('olp-operator', 'olp-operator'),
      loginDev('medicarte-operator', 'medicarte-operator'),
    ]);
  });

  afterAll(async () => database.end());

  it('restricts catalog access and mutations to MTD', async () => {
    const mtd = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/products`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(mtd.status).toBe(200);

    for (const [token, organizationId] of [
      [olpToken, olpOrganizationId],
      [medicarteToken, medicarteOrganizationId],
    ]) {
      const response = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/products`, {
        headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
      });
      expect(response.status).toBe(403);
    }

    const forbiddenMutation = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/products`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${olpToken}`,
        'x-organization-id': olpOrganizationId,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ codigoProducto: `DENIED-${randomUUID()}` }),
    });
    expect(forbiddenMutation.status).toBe(403);
  });

  it('supports individual CRUD, logical deletion, reactivation and audit', async () => {
    const code = `CRUD-${randomUUID()}`;
    let response = await createTariffProduct(code);
    expect(response.status).toBe(201);
    const created = (await response.json()) as { product: { id: string; active: boolean }; resultCode: string };
    expect(created.resultCode).toBe('PRODUCT_CREATED');

    response = await createTariffProduct(code.toLowerCase());
    expect(response.status).toBe(201);
    const duplicate = (await response.json()) as { resultCode: string };
    expect(duplicate.resultCode).toBe('PRODUCT_EXISTING');

    response = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/products/${created.product.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(response.status).toBe(200);
    const deactivated = (await response.json()) as { product: { active: boolean } };
    expect(deactivated.product.active).toBe(false);

    response = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/products/${created.product.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': mtdOrganizationId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ active: true }),
    });
    expect(response.status).toBe(200);
    const activated = (await response.json()) as { product: { active: boolean } };
    expect(activated.product.active).toBe(true);

    const audit = await database.query<{ action: string }>(
      `select action from audit_events where resource_type = 'tariff_annex_product' and resource_id = $1`,
      [created.product.id],
    );
    const actions = new Set(audit.rows.map((row) => row.action));
    expect(actions.has('TARIFF_PRODUCT_CREATED')).toBe(true);
    expect(actions.has('TARIFF_PRODUCT_DEACTIVATED')).toBe(true);
    expect(actions.has('TARIFF_PRODUCT_ACTIVATED')).toBe(true);
  });

  it('processes CSV rows independently and deduplicates the same file', async () => {
    const codeA = `IMPORT-A-${randomUUID()}`;
    const codeB = `IMPORT-B-${randomUUID()}`;
    const tariffHeaders = [
      'Codigo Medicamento',
      'Tarifa de la unidad',
      'Número de Expediente del INVIMA',
      'Consecutivo INVIMA (Presentación)',
      'Descripción Genérica del Medicamento (DCI)',
      'Descripción Comercial del Medicamento',
      'Laboratorio del Medicamento',
      'Tipo de Inclusion del Medicamento (PBS/NOPBS)',
    ];
    const tariffRow = (code: string) => `${code},10,EXP,CON,GEN,COM,LAB,PBS`;
    const csv = `${tariffHeaders.join(',')}\n${tariffRow(codeA)}\n,10,EXP,CON,GEN,COM,LAB,PBS\n${tariffRow(codeB)}\n${tariffRow(codeA)}\n`;
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'tariff.csv');
    const idempotencyKey = randomUUID();
    const headers = {
      authorization: `Bearer ${adminToken}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': idempotencyKey,
    };
    const first = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/imports`, {
      method: 'POST',
      headers,
      body: form,
    });
    expect(first.status).toBe(202);
    const batch = (await first.json()) as { id: string };

    const secondForm = new FormData();
    secondForm.append('file', new Blob([csv], { type: 'text/csv' }), 'tariff.csv');
    const second = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/imports`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': randomUUID() },
      body: secondForm,
    });
    expect(second.status).toBe(202);
    const duplicateBatch = (await second.json()) as { id: string };
    expect(duplicateBatch.id).toBe(batch.id);

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const status = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/imports/${batch.id}`, {
        headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
      });
      const value = (await status.json()) as { status: string };
      if (value.status === 'COMPLETED') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const rows = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/imports/${batch.id}/rows`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    const resultRows = (await rows.json()) as { items: Array<{ resultCode: string }> };
    expect(resultRows.items.map((row) => row.resultCode)).toEqual(
      expect.arrayContaining(['PRODUCT_CREATED', 'DUPLICATE_IN_FILE', 'INVALID_PRODUCT_CODE']),
    );
  });

  it('keeps unlisted authorization blocked, exports the causal, and revalidates asynchronously', async () => {
    const code = `REVALIDATE-${randomUUID()}`;
    const authorization = `AUTH-F8-${randomUUID()}`;
    const batch = await createAuthorizationImport(authorizationCsv({ authorization, medication: code }));
    await waitForAuthorizationImport(batch.id);
    await confirmAuthorizationImport(batch.id);
    const key = `${authorization.toUpperCase()}:${code.toUpperCase()}`;
    const blocked = await waitForItem(key);
    expect(blocked.operationStatus).toBe('BLOCKED');
    expect(blocked.tariffMembershipStatus).toBe('NOT_LISTED');

    let exportResponse = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/eps-novedades?format=csv`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(exportResponse.status).toBe(200);
    expect(await exportResponse.text()).toContain('PRODUCT_NOT_IN_TARIFF_ANNEX');

    const productResponse = await createTariffProduct(code);
    expect(productResponse.status).toBe(201);
    await waitForReady(blocked.id);

    const ready = await database.query<{ tariff_membership_status: string; operation_status: string }>(
      'select tariff_membership_status, operation_status from authorization_items where id = $1',
      [blocked.id],
    );
    expect(ready.rows[0]).toEqual({ tariff_membership_status: 'LISTED', operation_status: 'READY_TO_DISPENSE' });

    const audits = await database.query<{ action: string }>(
      `select action from audit_events where resource_id = $1`,
      [blocked.id],
    );
    expect(audits.rows.some((row) => row.action === 'TARIFF_ANNEX_REVALIDATION_STARTED')).toBe(true);
    expect(audits.rows.some((row) => row.action === 'AUTHORIZATION_READY_TO_DISPENSE')).toBe(true);
    // ADR-027: la revalidación automática tras crear el producto cierra la
    // novedad del Anexo sin recargar el archivo de autorizaciones.
    let openNovelties = await database.query<{ count: string }>(
      `select count(*)::text as count from novelties
       where authorization_item_id = $1 and active = true and code = 'ANX_001'`,
      [blocked.id],
    );
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (Number(openNovelties.rows[0]?.count ?? '0') === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
      openNovelties = await database.query<{ count: string }>(
        `select count(*)::text as count from novelties
         where authorization_item_id = $1 and active = true and code = 'ANX_001'`,
        [blocked.id],
      );
    }
    expect(Number(openNovelties.rows[0]?.count ?? '1')).toBe(0);
    const resolutionAudit = await database.query<{ count: string }>(
      `select count(*)::text as count from audit_events
       where action = 'NOVELTY_RESOLVED' and after->'novelties' @> '[{"code":"ANX_001"}]'::jsonb`,
    );
    expect(Number(resolutionAudit.rows[0]?.count ?? '0')).toBeGreaterThan(0);

    exportResponse = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/eps-novedades?format=csv`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    expect(await exportResponse.text()).not.toContain(key);
  });

  it('does not add a tariff causal to PBS and preserves NO PBS MIPRES validation', async () => {
    const pbsCode = `PBS-F8-${randomUUID()}`;
    const noPbsCode = `NO-PBS-F8-${randomUUID()}`;
    await registerTariffProducts(adminToken, [pbsCode]);
    await registerTariffProducts(adminToken, [noPbsCode], 'NO PBS');

    const pbsAuthorization = `AUTH-F8-PBS-${randomUUID()}`;
    const pbsBatch = await createAuthorizationImport(
      authorizationCsv({ authorization: pbsAuthorization, medication: pbsCode }),
    );
    await waitForAuthorizationImport(pbsBatch.id);
    await confirmAuthorizationImport(pbsBatch.id);
    const pbs = await waitForItem(`${pbsAuthorization.toUpperCase()}:${pbsCode.toUpperCase()}`);
    expect(pbs.operationStatus).toBe('READY_TO_DISPENSE');
    const pbsChecks = await database.query<{ count: string }>(
      'select count(*)::text as count from mipres_checks where authorization_item_id = $1',
      [pbs.id],
    );
    expect(Number(pbsChecks.rows[0]?.count ?? 0)).toBe(0);

    const noPbsAuthorization = `AUTH-F8-NO-PBS-${randomUUID()}`;
    const noPbsBatch = await createAuthorizationImport(
      authorizationCsv({
        authorization: noPbsAuthorization,
        medication: noPbsCode,
        prescription: '20260915000000000123',
      }),
    );
    await waitForAuthorizationImport(noPbsBatch.id);
    await confirmAuthorizationImport(noPbsBatch.id);
    const noPbs = await waitForItem(`${noPbsAuthorization.toUpperCase()}:${noPbsCode.toUpperCase()}`);
    expect(noPbs.operationStatus).toBe('BLOCKED');
    expect(noPbs.directionStatus).toBe('PENDING');
    const exportResponse = await fetch(`${apiUrl}/api/v1/admin/tariff-annex/eps-novedades?format=csv`, {
      headers: { authorization: `Bearer ${adminToken}`, 'x-organization-id': mtdOrganizationId },
    });
    const novedades = await exportResponse.text();
    expect(novedades).toContain('DIRECTION_PENDING');
  });

  it('does not change advanced operational records when a product is activated', async () => {
    const code = `ADVANCED-${randomUUID()}`;
    const batchId = randomUUID();
    const itemId = randomUUID();
    const authorization = `AUTH-ADV-${randomUUID()}`;
    await database.query(
      `insert into import_batches
         (id, organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
          processor_version, status, total_rows, valid_rows, confirmed_rows)
       values ($1, $2, (select id from users where username = 'foundation-admin'), 'adv.csv', 'text/csv', 1,
               $3, 1, 'COMPLETED', 1, 1, 1)`,
      [batchId, mtdOrganizationId, randomUUID().replaceAll('-', '').padEnd(64, '0')],
    );
    await database.query(
      `insert into authorization_items
         (id, numero_autorizacion, codigo_medicamento, authorization_key, source_data,
          source_status_normalized, source_prescripcion_normalized, no_prescripcion,
          enablement_status, coverage_type, direction_status, operation_status,
          coverage_rule_version, audit_status, tariff_membership_status, created_from_batch_id)
       values ($1, $2, $3, $4, '{}'::jsonb, '5', '', '', 'ENABLED', 'PBS', 'NOT_APPLICABLE',
               'DISPENSED', 'F2-COVERAGE-2', 'APPROVED', 'NOT_LISTED', $5)`,
      [itemId, authorization, code, `${authorization}:${code}`, batchId],
    );

    const product = await createTariffProduct(code);
    expect(product.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const current = await database.query<{
      operation_status: string;
      tariff_membership_status: string;
    }>('select operation_status, tariff_membership_status from authorization_items where id = $1', [itemId]);
    expect(current.rows[0]).toEqual({ operation_status: 'DISPENSED', tariff_membership_status: 'NOT_LISTED' });
  });
});
