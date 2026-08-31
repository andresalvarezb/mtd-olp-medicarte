import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:15432/authorization';
const mtdOrganizationId = '10000000-0000-4000-8000-000000000001';
const olpOrganizationId = '10000000-0000-4000-8000-000000000003';
const medicarteOrganizationId = '10000000-0000-4000-8000-000000000004';
const olpOperatorRoleId = '20000000-0000-4000-8000-000000000004';
const tariffReadPermissionId = '30000000-0000-4000-8000-000000000026';
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
let medicarteToken: string;

async function login(username: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'authorization-web',
    username,
    password,
  });
  const response = await fetch(
    `${keycloakUrl}/realms/authorization/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );
  const result = (await response.json()) as { access_token?: string };
  if (!result.access_token)
    throw new Error(`Keycloak login failed for ${username}: ${response.status}`);
  return result.access_token;
}

/** Identificador único ya normalizado (trim, mayúsculas) como lo hace la plataforma. */
function uniqueCode(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`.toUpperCase();
}

type ApiResult = { status: number; body: unknown; text: string };

async function callApi(
  token: string,
  method: string,
  path: string,
  organizationId: string,
  options: { idempotencyKey?: string; body?: unknown; file?: { name: string; content: Buffer; type: string } } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'x-organization-id': organizationId,
  };
  let body: BodyInit | undefined;
  if (options.file) {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(options.file.content)], { type: options.file.type }),
      options.file.name,
    );
    body = form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const response = await fetch(`${apiUrl}/api/v1${path}`, { method, headers, body });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // respuesta binaria o vacía
  }
  return { status: response.status, body: parsed, text };
}

function csvRow(values: string[]): string {
  return values.map((value) => (/["],/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)).join(',');
}

function authorizationCsv(
  rows: Array<{ authorization: string; medication: string; prescripcion: string; status: string; vigencia: string }>,
): string {
  return [
    csvRow(sourceColumns),
    ...rows.map((row) =>
      csvRow([
        'EPS-1',
        row.authorization,
        'CC',
        '123',
        'Paciente Anexo',
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
        row.vigencia,
        row.status,
        row.prescripcion,
        'prueba SPEC-014',
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

async function importAndConfirmAuthorizations(
  rows: Array<{ authorization: string; medication: string; prescripcion: string; status: string; vigencia: string }>,
): Promise<void> {
  const created = await callApi(adminToken, 'POST', '/imports', mtdOrganizationId, {
    idempotencyKey: randomUUID(),
    file: { name: 'authorizations.csv', content: Buffer.from(authorizationCsv(rows), 'utf8'), type: 'text/csv' },
  });
  expect(created.status).toBe(202);
  const batchId = (created.body as { id: string }).id;
  const deadline = Date.now() + 20_000;
  let status = '';
  while (Date.now() < deadline) {
    const result = await database.query<{ status: string }>(
      'select status from import_batches where id = $1',
      [batchId],
    );
    status = result.rows[0]?.status ?? '';
    if (status === 'LISTO_PARA_CONFIRMAR' || status === 'FALLIDO') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  expect(status).toBe('LISTO_PARA_CONFIRMAR');
  const confirmed = await callApi(adminToken, 'POST', `/imports/${batchId}/confirm`, mtdOrganizationId, {
    idempotencyKey: randomUUID(),
    body: {},
  });
  expect(confirmed.status).toBe(200);
}

async function getItemByAuthorizationKey(numero: string, medication: string): Promise<{
  id: string;
  operation_status: string | null;
  tariff_membership_status: string;
  version: number;
} | undefined> {
  const result = await database.query<{
    id: string;
    operation_status: string | null;
    tariff_membership_status: string;
    version: number;
  }>(
    `select id, operation_status, tariff_membership_status, version
     from authorization_items where numero_autorizacion = $1 and codigo_medicamento = $2`,
    [numero, medication],
  );
  return result.rows[0];
}

async function waitForItemStatus(
  numero: string,
  medication: string,
  expected: string,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await getItemByAuthorizationKey(numero, medication);
    if (item?.operation_status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const item = await getItemByAuthorizationKey(numero, medication);
  throw new Error(
    `Item ${numero}:${medication} did not reach ${expected}; current=${item?.operation_status ?? 'null'}`,
  );
}

async function waitForTariffMembership(
  numero: string,
  medication: string,
  expected: string,
  timeoutMs = 25_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await getItemByAuthorizationKey(numero, medication);
    if (item?.tariff_membership_status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const item = await getItemByAuthorizationKey(numero, medication);
  throw new Error(
    `Item ${numero}:${medication} did not reach membership ${expected}; current=${item?.tariff_membership_status ?? 'unknown'}`,
  );
}

async function waitForTariffImport(batchId: string): Promise<{ status: string; createdRows: number; totalRows: number; duplicateRows: number; rejectedRows: number; existingRows: number; reactivatedRows: number }> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await database.query<{
      status: string;
      created_rows: number;
      total_rows: number;
      duplicate_rows: number;
      rejected_rows: number;
      existing_rows: number;
      reactivated_rows: number;
    }>(
      `select status, created_rows, total_rows, duplicate_rows, rejected_rows, existing_rows, reactivated_rows
       from tariff_annex_imports where id = $1`,
      [batchId],
    );
    const status = result.rows[0]?.status;
    if (status === 'COMPLETADO' || status === 'FALLIDO') {
      const row = result.rows[0];
      return {
        status,
        createdRows: Number(row?.created_rows ?? 0),
        totalRows: Number(row?.total_rows ?? 0),
        duplicateRows: Number(row?.duplicate_rows ?? 0),
        rejectedRows: Number(row?.rejected_rows ?? 0),
        existingRows: Number(row?.existing_rows ?? 0),
        reactivatedRows: Number(row?.reactivated_rows ?? 0),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Tariff import ${batchId} did not finish`);
}

async function createTariffProductViaApi(codigo: string): Promise<{ status: number; body: { resultCode?: string; product?: { id: string; codigoProducto: string } } }> {
  const result = await callApi(adminToken, 'POST', '/admin/tariff-annex/products', mtdOrganizationId, {
    idempotencyKey: randomUUID(),
    body: { codigoProducto: codigo },
  });
  return { status: result.status, body: result.body as { resultCode?: string; product?: { id: string; codigoProducto: string } } };
}

describe('Gate F9 — Anexo Tarifario', () => {
  beforeAll(async () => {
    await database.connect();
    [adminToken, olpToken, medicarteToken] = await Promise.all([
      login('foundation-admin', 'foundation-admin'),
      login('olp-operator', 'olp-operator'),
      login('medicarte-operator', 'medicarte-operator'),
    ]);
  });

  afterAll(async () => database.end());

  it('permite a MTD Admin administrar el anexo y deniega a OLP y Medicarte en backend', async () => {
    const list = await callApi(adminToken, 'GET', '/admin/tariff-annex/products', mtdOrganizationId);
    expect(list.status).toBe(200);

    for (const [token, organizationId] of [
      [olpToken, olpOrganizationId],
      [medicarteToken, medicarteOrganizationId],
    ] as const) {
      expect((await callApi(token, 'GET', '/admin/tariff-annex/products', organizationId)).status).toBe(403);
      expect(
        (
          await callApi(token, 'POST', '/admin/tariff-annex/products', organizationId, {
            idempotencyKey: randomUUID(),
            body: { codigoProducto: 'HACK-1' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await callApi(token, 'DELETE', '/admin/tariff-annex/products/00000000-0000-4000-8000-000000000000', organizationId)
        ).status,
      ).toBe(403);
      expect(
        (
          await callApi(token, 'POST', '/admin/tariff-annex/imports', organizationId, {
            idempotencyKey: randomUUID(),
            file: { name: 'a.csv', content: Buffer.from('codigo_producto\n'), type: 'text/csv' },
          })
        ).status,
      ).toBe(403);
    }

    // Incluso con el permiso asignado, solo MTD puede operar el anexo.
    const granted = await database.query<{ permission_id: string }>(
      `insert into role_permissions (role_id, permission_id)
       select $1, $2 where not exists (
         select 1 from role_permissions where role_id = $1 and permission_id = $2
       )
       returning permission_id`,
      [olpOperatorRoleId, tariffReadPermissionId],
    );
    try {
      const olpWithPermission = await callApi(
        olpToken,
        'GET',
        '/admin/tariff-annex/products',
        olpOrganizationId,
      );
      expect(olpWithPermission.status).toBe(403);
      expect((olpWithPermission.body as { code?: string }).code).toBe('TARIFF_ANNEX_MTD_ONLY');
    } finally {
      if (granted.rows[0]) {
        await database.query('delete from role_permissions where role_id = $1 and permission_id = $2', [
          olpOperatorRoleId,
          tariffReadPermissionId,
        ]);
      }
    }
  });

  it('crea productos individualmente, deduplica, desactiva con historial y reactiva', async () => {
    const code = uniqueCode('ANX-A');
    const first = await createTariffProductViaApi(code);
    expect(first.status).toBe(200);
    expect(first.body.resultCode).toBe('PRODUCT_CREATED');
    expect(first.body.product?.codigoProducto).toBe(code);

    const duplicate = await createTariffProductViaApi(code);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.resultCode).toBe('PRODUCT_EXISTING');
    expect(duplicate.body.product?.id).toBe(first.body.product?.id);

    const count = await database.query<{ count: string }>(
      'select count(*)::text as count from tariff_annex_products where codigo_producto = $1',
      [code],
    );
    expect(count.rows[0]?.count).toBe('1');

    const productId = first.body.product?.id as string;
    const deactivate = await callApi(adminToken, 'DELETE', `/admin/tariff-annex/products/${productId}`, mtdOrganizationId);
    expect(deactivate.status).toBe(200);
    expect((deactivate.body as { changed: boolean }).changed).toBe(true);
    const auditsAfterDeactivation = await database.query<{ count: string }>(
      `select count(*)::text as count from audit_events where resource_type = 'tariff_annex_product' and resource_id = $1`,
      [productId],
    );
    expect(Number(auditsAfterDeactivation.rows[0]?.count ?? 0)).toBeGreaterThan(0);

    const reactivated = await createTariffProductViaApi(code);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.resultCode).toBe('PRODUCT_REACTIVATED');

    const productAudits = await database.query<{ actions: string[] }>(
      `select array_agg(action order by occurred_at) as actions
       from audit_events where resource_type = 'tariff_annex_product' and resource_id = $1`,
      [productId],
    );
    expect(productAudits.rows[0]?.actions).toContain('TARIFF_PRODUCT_CREATED');
    expect(productAudits.rows[0]?.actions).toContain('TARIFF_PRODUCT_DEACTIVATED');
    expect(productAudits.rows[0]?.actions).toContain('TARIFF_PRODUCT_UPDATED');
    expect(productAudits.rows[0]?.actions).toContain('TARIFF_PRODUCT_EXISTING');

    await database.query('delete from tariff_annex_products where id = $1', [productId]);
  });

  it('procesa el cargue masivo con resultado por fila y es idempotente', async () => {
    const runSuffix = uniqueCode('BULK').replace('BULK-', '');
    const longCode = 'X'.repeat(300);
    const fileContent = `codigo_producto\nANX-BULK-1-${runSuffix}\nANX-BULK-2-${runSuffix}\nANX-BULK-2-${runSuffix}\n${longCode}\n`;
    const first = await callApi(adminToken, 'POST', '/admin/tariff-annex/imports', mtdOrganizationId, {
      idempotencyKey: randomUUID(),
      file: { name: 'anexo.csv', content: Buffer.from(fileContent, 'utf8'), type: 'text/csv' },
    });
    expect(first.status).toBe(202);
    const batchId = (first.body as { id: string }).id;
    const result = await waitForTariffImport(batchId);
    expect(result.status).toBe('COMPLETADO');
    expect(result).toMatchObject({ totalRows: 4, createdRows: 2, duplicateRows: 1, rejectedRows: 1 });

    const rowsResponse = await callApi(
      adminToken,
      'GET',
      `/admin/tariff-annex/imports/${batchId}/rows?limit=100`,
      mtdOrganizationId,
    );
    expect(rowsResponse.status).toBe(200);
    const rows = (rowsResponse.body as { items: Array<{ rowNumber: number; resultCode: string; codigoProducto: string | null }> }).items;
    expect(rows.map((row) => row.resultCode)).toEqual([
      'PRODUCT_CREATED',
      'PRODUCT_CREATED',
      'DUPLICATE_IN_FILE',
      'INVALID_PRODUCT_CODE',
    ]);

    // Mismo archivo, otra clave de idempotencia: mismo lote, sin nuevos efectos.
    const replay = await callApi(adminToken, 'POST', '/admin/tariff-annex/imports', mtdOrganizationId, {
      idempotencyKey: randomUUID(),
      file: { name: 'anexo.csv', content: Buffer.from(fileContent, 'utf8'), type: 'text/csv' },
    });
    expect(replay.status).toBe(202);
    expect((replay.body as { id: string }).id).toBe(batchId);
    const replayed = await waitForTariffImport(batchId);
    expect(replayed.createdRows).toBe(2);

    const products = await database.query<{ count: string }>(
      `select count(*)::text as count from tariff_annex_products
       where codigo_producto in ($1, $2)`,
      [`ANX-BULK-1-${runSuffix}`, `ANX-BULK-2-${runSuffix}`],
    );
    expect(products.rows[0]?.count).toBe('2');
  });

  it('rechaza un archivo sin filas de datos', async () => {
    const created = await callApi(adminToken, 'POST', '/admin/tariff-annex/imports', mtdOrganizationId, {
      idempotencyKey: randomUUID(),
      file: { name: 'vacio.csv', content: Buffer.from('codigo_producto\n', 'utf8'), type: 'text/csv' },
    });
    expect(created.status).toBe(202);
    const batchId = (created.body as { id: string }).id;
    const result = await waitForTariffImport(batchId);
    expect(result.status).toBe('FALLIDO');
    const lastError = await database.query<{ last_error_code: string | null }>(
      'select last_error_code from tariff_annex_imports where id = $1',
      [batchId],
    );
    expect(['EMPTY_FILE', 'INVALID_FILE_FORMAT']).toContain(lastError.rows[0]?.last_error_code);
  });

  it('bloquea autorizaciones con producto fuera del anexo y las revalida automáticamente al agregarlo', async () => {
    const okProduct = uniqueCode('TARIF-OK');
    const missingProduct = uniqueCode('TARIF-MISS');
    const okCreated = await createTariffProductViaApi(okProduct);
    expect(okCreated.body.resultCode).toBe('PRODUCT_CREATED');

    const authOk = uniqueCode('AUTH-T9-OK');
    const authMissing = uniqueCode('AUTH-T9-MISS');
    const authExpired = uniqueCode('AUTH-T9-EXP');
    const authNoPbs = uniqueCode('AUTH-T9-NOPBS');
    await importAndConfirmAuthorizations([
      { authorization: authOk, medication: okProduct, prescripcion: '', status: '5', vigencia: '20261231' },
      { authorization: authMissing, medication: missingProduct, prescripcion: '', status: '5', vigencia: '20261231' },
      { authorization: authExpired, medication: missingProduct, prescripcion: '', status: '5', vigencia: '20200101' },
      {
        authorization: authNoPbs,
        medication: missingProduct,
        prescripcion: '20260915123',
        status: '5',
        vigencia: '20261231',
      },
    ]);

    // Producto dentro del anexo + demás validaciones correctas => LISTO.
    const okItem = await getItemByAuthorizationKey(authOk, okProduct);
    expect(okItem).toMatchObject({ operation_status: 'LISTO_PARA_DISPENSAR', tariff_membership_status: 'LISTADO' });

    // Productos fuera del anexo => BLOCKED con causal del anexo y auditoría.
    const missingItem = await getItemByAuthorizationKey(authMissing, missingProduct);
    expect(missingItem).toMatchObject({ operation_status: 'BLOQUEADO', tariff_membership_status: 'NO_LISTADO' });
    const validationAudits = await database.query<{ count: string }>(
      `select count(*)::text as count from audit_events
       where action = 'TARIFF_ANNEX_VALIDATION_FAILED' and resource_id = $1`,
      [missingItem?.id],
    );
    expect(Number(validationAudits.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);

    // La base de novedades EPS expone los registros bloqueados con la causal.
    const epsBefore = await callApi(adminToken, 'GET', '/exports/eps-novedades?format=csv', mtdOrganizationId);
    expect(epsBefore.status).toBe(200);
    expect(epsBefore.text).toContain('PRODUCT_NOT_IN_TARIFF_ANNEX');
    expect(epsBefore.text).toContain(authMissing);

    // MTD agrega el producto → evento → revalidación automática.
    const activated = await createTariffProductViaApi(missingProduct);
    expect(activated.body.resultCode).toBe('PRODUCT_CREATED');
    const productId = activated.body.product?.id as string;

    await waitForItemStatus(authMissing, missingProduct, 'LISTO_PARA_DISPENSAR');
    // Solo desaparece la causal del anexo; la vigencia vencida continúa activa.
    await waitForItemStatus(authExpired, missingProduct, 'VENCIDO');
    // Un NO PBS continúa exigiendo direccionamiento MIPRES.
    await waitForTariffMembership(authNoPbs, missingProduct, 'LISTADO');
    const noPbsItem = await getItemByAuthorizationKey(authNoPbs, missingProduct);
    expect(noPbsItem).toMatchObject({ operation_status: 'BLOQUEADO', tariff_membership_status: 'LISTADO' });

    // Evento de dominio normal y notificaciones OLP/Medicarte con idempotencia.
    const readyItem = await getItemByAuthorizationKey(authMissing, missingProduct);
    const readyAudits = await database.query<{ actions: string[] }>(
      `select array_agg(action) as actions from audit_events where resource_id = $1`,
      [readyItem?.id],
    );
    for (const action of [
      'TARIFF_ANNEX_REVALIDATION_STARTED',
      'TARIFF_ANNEX_VALIDATION_PASSED',
      'AUTHORIZATION_BECAME_READY_TO_DISPENSE',
      'AUTHORIZATION_READY_TO_DISPENSE',
    ]) {
      expect(readyAudits.rows[0]?.actions).toContain(action);
    }
    const notifications = await database.query<{ count: string }>(
      `select count(*)::text as count from outbox_events
       where event_type = 'notification.email'
         and payload->>'itemId' = $1
         and payload->>'notificationType' = 'AUTHORIZATION_READY_TO_DISPENSE'`,
      [readyItem?.id],
    );
    expect(Number(notifications.rows[0]?.count ?? 0)).toBe(2);
    const jobResults = await database.query<{ result: { revalidatedItems: number } }>(
      `select result from job_results where queue = 'tariff-annex' order by completed_at desc limit 1`,
    );
    expect(jobResults.rows.length).toBeGreaterThan(0);

    // Revalidar dos veces el mismo producto no duplica efectos.
    const revalidationEventsBefore = await database.query<{ count: string }>(
      `select count(*)::text as count from outbox_events
       where event_type = 'tariff.product.activated' and payload->>'tariffProductId' = $1`,
      [productId],
    );
    const repeated = await createTariffProductViaApi(missingProduct);
    expect(repeated.body.resultCode).toBe('PRODUCT_EXISTING');
    const versionBefore = (await getItemByAuthorizationKey(authMissing, missingProduct))?.version;
    const revalidationEventsAfter = await database.query<{ count: string }>(
      `select count(*)::text as count from outbox_events
       where event_type = 'tariff.product.activated' and payload->>'tariffProductId' = $1`,
      [productId],
    );
    expect(revalidationEventsAfter.rows[0]?.count).toBe(revalidationEventsBefore.rows[0]?.count);
    const versionAfter = (await getItemByAuthorizationKey(authMissing, missingProduct))?.version;
    expect(versionAfter).toBe(versionBefore);

    // La base de novedades EPS conserva las causales restantes sin ocultar las demás.
    const epsAfter = await callApi(adminToken, 'GET', '/exports/eps-novedades?format=csv', mtdOrganizationId);
    expect(epsAfter.status).toBe(200);
    const expiredLine = epsAfter.text
      .split('\n')
      .find((line) => line.includes(authExpired));
    expect(expiredLine).toBeDefined();
    expect(expiredLine).toContain('AUTHORIZATION_EXPIRED');
    expect(expiredLine).not.toContain('PRODUCT_NOT_IN_TARIFF_ANNEX');
    const noPbsLine = epsAfter.text.split('\n').find((line) => line.includes(authNoPbs));
    expect(noPbsLine).toContain('DIRECTION_PENDING');
  });

  it('revalida diez autorizaciones bloqueadas por el mismo producto', async () => {
    const product = uniqueCode('TARIF-TEN');
    const prefix = uniqueCode('AUTH-T9-TEN').slice(0, -3);
    await importAndConfirmAuthorizations(
      Array.from({ length: 10 }, (_, index) => ({
        authorization: `${prefix}-${index}`,
        medication: product,
        prescripcion: '',
        status: '5',
        vigencia: '20261231',
      })),
    );
    const activated = await createTariffProductViaApi(product);
    expect(activated.body.resultCode).toBe('PRODUCT_CREATED');

    const deadline = Date.now() + 30_000;
    let readyCount = 0;
    while (Date.now() < deadline) {
      const result = await database.query<{ count: string }>(
        `select count(*)::text as count from authorization_items
         where codigo_medicamento = $1 and operation_status = 'LISTO_PARA_DISPENSAR'`,
        [product],
      );
      readyCount = Number(result.rows[0]?.count ?? 0);
      if (readyCount === 10) break;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    expect(readyCount).toBe(10);
    const notifications = await database.query<{ count: string }>(
      `select count(*)::text as count from outbox_events
       where event_type = 'notification.email'
         and payload->>'notificationType' = 'AUTHORIZATION_READY_TO_DISPENSE'
         and payload->>'itemId' in (
           select id::text from authorization_items where codigo_medicamento = $1
         )`,
      [product],
    );
    expect(Number(notifications.rows[0]?.count ?? 0)).toBe(20);
  });

  it('no modifica registros ya DISPENSADO durante la revalidación', async () => {
    const product = uniqueCode('TARIF-ADV');
    const authorization = uniqueCode('AUTH-T9-ADV');
    await importAndConfirmAuthorizations([
      { authorization, medication: product, prescripcion: '', status: '5', vigencia: '20261231' },
    ]);
    await database.query(
      `update authorization_items
       set operation_status = 'DISPENSADO', audit_status = 'APROBADO', tariff_membership_status = 'NO_LISTADO'
       where numero_autorizacion = $1 and codigo_medicamento = $2`,
      [authorization, product],
    );
    const activated = await createTariffProductViaApi(product);
    expect(activated.body.resultCode).toBe('PRODUCT_CREATED');
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const item = await getItemByAuthorizationKey(authorization, product);
    expect(item).toMatchObject({
      operation_status: 'DISPENSADO',
      tariff_membership_status: 'NO_LISTADO',
    });
  });

  it('exporta novedades EPS en CSV y XLSX solo para MTD', async () => {
    const csvExport = await callApi(adminToken, 'GET', '/exports/eps-novedades?format=csv', mtdOrganizationId);
    expect(csvExport.status).toBe(200);
    const header = csvExport.text.split('\n')[0];
    for (const column of [
      'authorization_key',
      'numero_autorizacion',
      'codigo_medicamento',
      'coverage_type',
      'resultado_validacion',
      'causal',
      'detalle_novedad',
    ]) {
      expect(header).toContain(column);
    }
    const xlsxExport = await callApi(adminToken, 'GET', '/exports/eps-novedades?format=xlsx', mtdOrganizationId);
    expect(xlsxExport.status).toBe(200);

    const olpExport = await callApi(olpToken, 'GET', '/exports/eps-novedades?format=csv', olpOrganizationId);
    expect(olpExport.status).toBe(403);
    const medicarteExport = await callApi(
      medicarteToken,
      'GET',
      '/exports/eps-novedades?format=csv',
      medicarteOrganizationId,
    );
    expect(medicarteExport.status).toBe(403);

    const exportAudit = await database.query<{ count: string }>(
      `select count(*)::text as count from audit_events where action = 'EPS_NOVEDADES_EXPORT_CREATED'`,
    );
    expect(Number(exportAudit.rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(3);
  });
});
