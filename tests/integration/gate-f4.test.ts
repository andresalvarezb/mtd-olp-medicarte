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

function csvValue(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(values: string[]): string {
  return values.map(csvValue).join(',');
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
        'Paciente de prueba F4',
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
        'prueba F4',
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

async function login(username: string, password: string): Promise<string> {
  return loginDev(username, password); // ADR-026
}

async function createImport(token: string, content: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/csv' }), 'authorizations.csv');
  const response = await fetch(`${apiUrl}/api/v1/imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': randomUUID(),
    },
    body: form,
  });
  if (response.status !== 202)
    throw new Error(`Import creation failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as { id: string };
}

async function waitForBatch(
  token: string,
  batchId: string,
): Promise<{ status: string; validRows: number }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/v1/imports/${batchId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': mtdOrganizationId },
    });
    if (response.ok) {
      const batch = (await response.json()) as { status: string; validRows: number };
      if (batch.status === 'READY_TO_CONFIRM' || batch.status === 'COMPLETED') return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Import batch never became ready');
}

async function confirmImport(token: string, batchId: string, idempotencyKey?: string): Promise<Response> {
  return fetch(`${apiUrl}/api/v1/imports/${batchId}/confirm`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': mtdOrganizationId,
      'idempotency-key': idempotencyKey ?? randomUUID(),
      'content-type': 'application/json',
    },
    body: '{}',
  });
}

async function confirmReadyItem(suffix: string): Promise<string> {
  const authorization = `AUTH-F4-${randomUUID()}`;
  const batch = await createImport(
    adminToken,
    authorizationCsv([
      { authorization, medication: `MED-F4-${suffix}`, prescripcion: '', status: '5' },
    ]),
  );
  await waitForBatch(adminToken, batch.id);
  const confirmation = await confirmImport(adminToken, batch.id);
  expect(confirmation.status).toBe(200);
  const items = await database.query<{ id: string; operation_status: string | null }>(
    'select id, operation_status from authorization_items where numero_autorizacion = $1',
    [authorization.toUpperCase()],
  );
  const item = items.rows[0];
  if (!item) throw new Error('Expected item to be confirmed');
  expect(item.operation_status).toBe('READY_TO_DISPENSE');
  return item.id;
}

async function waitForNotificationsSettled(
  where: string,
  values: unknown[],
): Promise<Map<string, number>> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = await database.query<{ status: string; count: string }>(
      `select status, count(*)::text as count from notifications where ${where} group by status`,
      values,
    );
    const counts = new Map(rows.rows.map((row) => [row.status, Number(row.count)]));
    const settled = counts.size > 0 && !counts.has('PENDING');
    if (settled) return counts;
    if (Date.now() > deadline) throw new Error('Notifications never settled');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function waitForNotificationCount(
  where: string,
  values: unknown[],
  status: string,
  expected: number,
): Promise<Map<string, number>> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = await database.query<{ status: string; count: string }>(
      `select status, count(*)::text as count from notifications where ${where} group by status`,
      values,
    );
    const counts = new Map(rows.rows.map((row) => [row.status, Number(row.count)]));
    if ((counts.get(status) ?? 0) >= expected && !counts.has('PENDING')) return counts;
    if (Date.now() > deadline) throw new Error(`Notification count never reached ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function createBulkBatch(
  token: string,
  organizationId: string,
  content: string,
  idempotencyKey = randomUUID(),
): Promise<Response> {
  const form = new FormData();
  form.append('operationType', 'ASSIGN_DISPENSATION_LOCATION');
  form.append('file', new Blob([content], { type: 'text/csv' }), 'locations.csv');
  return fetch(`${apiUrl}/api/v1/bulk-updates`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-organization-id': organizationId,
      'idempotency-key': idempotencyKey,
    },
    body: form,
  });
}

type BulkBatchResponse = {
  id: string;
  status: string;
  lastErrorCode: string | null;
  totalRows: number;
  processedRows: number;
  updatedRows: number;
  unchangedRows: number;
  rejectedRows: number;
};

async function waitForBulkBatch(
  token: string,
  organizationId: string,
  batchId: string,
): Promise<BulkBatchResponse> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/v1/bulk-updates/${batchId}`, {
      headers: { authorization: `Bearer ${token}`, 'x-organization-id': organizationId },
    });
    if (response.ok) {
      const batch = (await response.json()) as BulkBatchResponse;
      if (batch.status === 'COMPLETED' || batch.status === 'FAILED') return batch;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Bulk update batch never settled');
}

function locationCsv(
  rows: Array<{ authorizationKey: string; location: string }>,
): string {
  return [
    'authorization_key,lugar_dispensacion',
    ...rows.map((row) => csvRow([row.authorizationKey, row.location])),
    '',
  ].join('\n');
}

describe('Gate F4', () => {
  beforeAll(async () => {
    await database.connect();
    [adminToken, olpToken, medicarteToken] = await Promise.all([
      login('foundation-admin', 'foundation-admin'),
      login('olp-operator', 'olp-operator'),
      login('medicarte-operator', 'medicarte-operator'),
    ]);
  });

  afterAll(async () => database.end());

  it('notifica disponibilidad a OLP y MEDICARTE una sola vez por versión', async () => {
    // Destinatarios parametrizables administrados por MTD (auditados).
    for (const [type, organizationId] of [
      ['AUTHORIZATION_READY_TO_DISPENSE', olpOrganizationId],
      ['AUTHORIZATION_READY_TO_DISPENSE', medicarteOrganizationId],
      ['DISPENSATION_LOCATION_ASSIGNED', olpOrganizationId],
      ['DISPENSATION_LOCATION_CHANGED', olpOrganizationId],
    ] as const) {
      const response = await fetch(`${apiUrl}/api/v1/admin/notification-recipients`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'x-organization-id': mtdOrganizationId,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          notificationType: type,
          organizationId,
          email: `operaciones-${type.toLowerCase()}-${organizationId.slice(0, 5)}@example.test`,
        }),
      });
      expect(response.status).toBe(201);
    }

    const itemId = await confirmReadyItem('ready');
    await waitForNotificationCount(
      "notification_type = 'AUTHORIZATION_READY_TO_DISPENSE' and item_id = $1",
      [itemId],
      'SENT',
      2,
    );
    const notifications = await database.query<{ recipient_organization_id: string; status: string }>(
      `select recipient_organization_id, status from notifications
       where notification_type = 'AUTHORIZATION_READY_TO_DISPENSE' and item_id = $1`,
      [itemId],
    );
    expect(notifications.rows).toHaveLength(2);
    expect(new Set(notifications.rows.map((row) => row.recipient_organization_id))).toEqual(
      new Set([olpOrganizationId, medicarteOrganizationId]),
    );
    expect(notifications.rows.every((row) => row.status === 'SENT')).toBe(true);

    const audits = await database.query<{ action: string }>(
      `select action from audit_events
       where action = 'AUTHORIZATION_READY_TO_DISPENSE' and resource_id = $1`,
      [itemId],
    );
    expect(audits.rows.length).toBeGreaterThan(0);
  });

  it('no duplica la notificación al reconfirmar con la misma llave de idempotencia', async () => {
    const authorization = `AUTH-F4-IDEM-${randomUUID()}`;
    const batch = await createImport(
      adminToken,
      authorizationCsv([
        { authorization, medication: 'MED-F4-IDEM', prescripcion: '', status: '5' },
      ]),
    );
    await waitForBatch(adminToken, batch.id);
    const idempotencyKey = randomUUID();
    const first = await confirmImport(adminToken, batch.id, idempotencyKey);
    expect(first.status).toBe(200);
    const items = await database.query<{ id: string }>(
      'select id from authorization_items where numero_autorizacion = $1',
      [authorization.toUpperCase()],
    );
    const itemId = items.rows[0]?.id;
    if (!itemId) throw new Error('Expected item');
    await waitForNotificationCount(
      "notification_type = 'AUTHORIZATION_READY_TO_DISPENSE' and item_id = $1",
      [itemId],
      'SENT',
      2,
    );

    const second = await confirmImport(adminToken, batch.id, idempotencyKey);
    expect(second.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const notifications = await database.query<{ count: string }>(
      `select count(*)::text as count from notifications
       where notification_type = 'AUTHORIZATION_READY_TO_DISPENSE' and item_id = $1`,
      [itemId],
    );
    expect(Number(notifications.rows[0]?.count ?? '0')).toBe(2);
  });

  it('procesa el lote MEDICARTE de lugar_dispensacion con historial y evento por versión', { timeout: 90_000 }, async () => {
    const itemId = await confirmReadyItem('bulk');
    const itemKey = await database.query<{ authorization_key: string }>(
      'select authorization_key from authorization_items where id = $1',
      [itemId],
    );
    const authorizationKey = itemKey.rows[0]?.authorization_key;
    if (!authorizationKey) throw new Error('Expected authorization key');

    // Actor incorrecto: OLP no puede ejecutar la operación de MEDICARTE.
    const forbidden = await createBulkBatch(olpToken, olpOrganizationId, '');
    expect(forbidden.status).toBe(403);

    // Columnas extra: el archivo completo se rechaza con INVALID_HEADERS.
    const extraColumns = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      `authorization_key,lugar_dispensacion,extra\n${authorizationKey},Calle 1,X\n`,
    );
    expect(extraColumns.status).toBe(202);
    const extraBatchId = ((await extraColumns.json()) as { id: string }).id;
    const extraBatch = await waitForBulkBatch(medicarteToken, medicarteOrganizationId, extraBatchId);
    expect(extraBatch.status).toBe('FAILED');
    expect(extraBatch.lastErrorCode).toBe('INVALID_HEADERS');

    // Primera asignación.
    const first = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      locationCsv([{ authorizationKey, location: 'Calle 40 # 12-34' }]),
    );
    expect(first.status).toBe(202);
    const firstBatch = await waitForBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      ((await first.json()) as { id: string }).id,
    );
    expect(firstBatch).toMatchObject({ status: 'COMPLETED', updatedRows: 1, rejectedRows: 0 });
    const afterFirst = await database.query<{
      lugar_dispensacion: string;
      operational_version: number;
    }>('select lugar_dispensacion, operational_version from authorization_items where id = $1', [
      itemId,
    ]);
    expect(afterFirst.rows[0]).toMatchObject({
      lugar_dispensacion: 'Calle 40 # 12-34',
      operational_version: 1,
    });

    await waitForNotificationCount(
      "notification_type = 'DISPENSATION_LOCATION_ASSIGNED' and item_id = $1",
      [itemId],
      'SENT',
      1,
    );

    // Cambio real → nueva versión y notificación CHANGED.
    const second = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      locationCsv([{ authorizationKey, location: 'Carrera 7 # 45-67' }]),
    );
    const secondBatch = await waitForBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      ((await second.json()) as { id: string }).id,
    );
    expect(secondBatch).toMatchObject({ status: 'COMPLETED', updatedRows: 1 });
    const afterSecond = await database.query<{
      lugar_dispensacion: string;
      operational_version: number;
    }>('select lugar_dispensacion, operational_version from authorization_items where id = $1', [
      itemId,
    ]);
    expect(afterSecond.rows[0]).toMatchObject({
      lugar_dispensacion: 'Carrera 7 # 45-67',
      operational_version: 2,
    });
    await waitForNotificationCount(
      "notification_type = 'DISPENSATION_LOCATION_CHANGED' and item_id = $1",
      [itemId],
      'SENT',
      1,
    );

    // Valor idéntico (tras normalizar espacios) → UNCHANGED_VALUE sin nueva
    // versión ni evento. El archivo difiere en bytes del anterior para no
    // deduplicar por file_hash (SPEC-009).
    const third = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      locationCsv([{ authorizationKey, location: '  Carrera  7  #  45-67  ' }]),
    );
    const thirdBatch = await waitForBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      ((await third.json()) as { id: string }).id,
    );
    expect(thirdBatch).toMatchObject({ status: 'COMPLETED', unchangedRows: 1, updatedRows: 0 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const changedCount = await database.query<{ count: string }>(
      `select count(*)::text as count from notifications
       where notification_type = 'DISPENSATION_LOCATION_CHANGED' and item_id = $1`,
      [itemId],
    );
    expect(Number(changedCount.rows[0]?.count ?? '0')).toBe(1);

    // Historial append-only con antes/después, actor, lote, fila y versión.
    const changes = await database.query<{
      previous_value: string | null;
      new_value: string;
      previous_operational_version: number;
      new_operational_version: number;
      actor_id: string;
      organization_id: string;
      bulk_update_batch_id: string | null;
    }>(
      `select previous_value, new_value, previous_operational_version, new_operational_version,
              actor_id, organization_id, bulk_update_batch_id
       from operational_field_changes where authorization_item_id = $1 order by created_at asc`,
      [itemId],
    );
    expect(changes.rows).toHaveLength(2);
    expect(changes.rows[0]).toMatchObject({
      previous_value: null,
      new_value: 'Calle 40 # 12-34',
      previous_operational_version: 0,
      new_operational_version: 1,
    });
    expect(changes.rows[1]).toMatchObject({
      previous_value: 'Calle 40 # 12-34',
      new_value: 'Carrera 7 # 45-67',
      new_operational_version: 2,
    });
    expect(changes.rows.every((row) => row.actor_id && row.organization_id)).toBe(true);

    // Reintentos/redelivery del evento outbox no duplican el correo.
    const locationNotification = await database.query<{ id: string; gmail_message_id: string | null }>(
      `select id, gmail_message_id from notifications
       where notification_type = 'DISPENSATION_LOCATION_CHANGED' and item_id = $1`,
      [itemId],
    );
    const gmailMessageId = locationNotification.rows[0]?.gmail_message_id;
    expect(gmailMessageId).toBeTruthy();
    const changedEvents = await database.query<{ id: string }>(
      `select id from outbox_events
       where event_type = 'notification.email'
         and payload->>'notificationType' = 'DISPENSATION_LOCATION_CHANGED'
         and payload->>'itemId' = $1`,
      [itemId],
    );
    expect(changedEvents.rows).toHaveLength(1);
    const changedEventId = changedEvents.rows[0]?.id;
    if (!changedEventId) throw new Error('Expected CHANGED outbox event');
    const redelivered = await database.query<{ id: string }>(
      `update outbox_events set status = 'PENDING', dispatched_at = null where id = $1 returning id`,
      [changedEventId],
    );
    expect(redelivered.rows).toHaveLength(1);
    const deadline = Date.now() + 20_000;
    for (;;) {
      const count = await database.query<{ count: string }>(
        `select count(*)::text as count from notifications
         where notification_type = 'DISPENSATION_LOCATION_CHANGED' and item_id = $1`,
        [itemId],
      );
      const events = await database.query<{ status: string }>(
        `select status from outbox_events where id = $1`,
        [changedEventId],
      );
      if (events.rows.every((row) => row.status === 'PROCESSED')) {
        expect(Number(count.rows[0]?.count ?? '0')).toBe(1);
        break;
      }
      if (Date.now() > deadline) throw new Error('Outbox event never settled after redelivery');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  });

  it('rechaza filas fuera de alcance, sin llave o con valor vacío sin revertir las válidas', { timeout: 60_000 }, async () => {
    const readyItemId = await confirmReadyItem('mixed');
    const keyRows = await database.query<{ authorization_key: string }>(
      'select authorization_key from authorization_items where id = $1',
      [readyItemId],
    );
    const readyKey = keyRows.rows[0]?.authorization_key;
    if (!readyKey) throw new Error('Expected authorization key');
    const batch = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      [
        'authorization_key,lugar_dispensacion',
        csvRow([readyKey, '   ']),
        csvRow([readyKey, 'Calle valida 1']),
        csvRow(['FUERA:LEJA', 'Calle fuera de alcance']),
        csvRow(['', 'Sin llave']),
        '',
      ].join('\n'),
    );
    expect(batch.status).toBe(202);
    const batchId = ((await batch.json()) as { id: string }).id;
    const result = await waitForBulkBatch(medicarteToken, medicarteOrganizationId, batchId);
    // La fila fuera de alcance y las inválidas se rechazan; la válida se aplica.
    expect(result.status).toBe('COMPLETED');
    expect(result.updatedRows).toBe(1);
    expect(result.rejectedRows).toBeGreaterThanOrEqual(2);
    const rows = await database.query<{ row_number: number; result_code: string }>(
      `select row_number, result_code from bulk_update_rows where batch_id = $1 order by row_number`,
      [batchId],
    );
    // La numeración de filas corresponde a la línea del archivo (encabezado = 1).
    const byRow = new Map(rows.rows.map((row) => [row.row_number, row.result_code]));
    expect(byRow.get(2)).toBe('MISSING_VALUE');
    expect(byRow.get(3)).toBe('ROW_UPDATED');
    expect(byRow.get(4)).toBe('AUTHORIZATION_ITEM_NOT_FOUND');
    expect(byRow.get(5)).toBe('MISSING_BUSINESS_KEY');
    const updated = await database.query<{ lugar_dispensacion: string }>(
      'select lugar_dispensacion from authorization_items where id = $1',
      [readyItemId],
    );
    expect(updated.rows[0]?.lugar_dispensacion).toBe('Calle valida 1');
  });

  it('mantiene el valor persistido aunque la entrega falle y permite reintentar desde la bandeja', { timeout: 90_000 }, async () => {
    const itemId = await confirmReadyItem('gmail');
    const keyRows = await database.query<{ authorization_key: string }>(
      'select authorization_key from authorization_items where id = $1',
      [itemId],
    );
    const authorizationKey = keyRows.rows[0]?.authorization_key;
    if (!authorizationKey) throw new Error('Expected authorization key');

    // Retirar el destinatario simula una entrega imposible: el correo no sale
    // pero el valor de negocio debe quedar persistido (ADR-006).
    const recipientList = await fetch(`${apiUrl}/api/v1/admin/notification-recipients?notificationType=DISPENSATION_LOCATION_ASSIGNED`, {
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': mtdOrganizationId,
      },
    });
    expect(recipientList.status).toBe(200);
    const recipients = (await recipientList.json()) as Array<{ id: string; email: string }>;
    for (const recipient of recipients) {
      const removed = await fetch(
        `${apiUrl}/api/v1/admin/notification-recipients/${recipient.id}`,
        {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${adminToken}`,
            'x-organization-id': mtdOrganizationId,
          },
        },
      );
      expect(removed.status).toBe(200);
    }

    const batch = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      locationCsv([{ authorizationKey, location: 'Calle persistente 99' }]),
    );
    const batchId = ((await batch.json()) as { id: string }).id;
    const batchResult = await waitForBulkBatch(medicarteToken, medicarteOrganizationId, batchId);
    expect(batchResult.status).toBe('COMPLETED');
    const item = await database.query<{ lugar_dispensacion: string; operational_version: number }>(
      'select lugar_dispensacion, operational_version from authorization_items where id = $1',
      [itemId],
    );
    expect(item.rows[0]).toMatchObject({
      lugar_dispensacion: 'Calle persistente 99',
      operational_version: 1,
    });
    await waitForNotificationsSettled(
      "notification_type = 'DISPENSATION_LOCATION_ASSIGNED' and item_id = $1",
      [itemId],
    );

    // Bandeja administrativa: la notificación queda visible con estado e intentos.
    const list = await fetch(
      `${apiUrl}/api/v1/admin/notifications?notificationType=DISPENSATION_LOCATION_ASSIGNED`,
      {
        headers: {
          authorization: `Bearer ${adminToken}`,
          'x-organization-id': mtdOrganizationId,
        },
      },
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: Array<{
        id: string;
        itemId: string | null;
        status: string;
        attempts: number;
        recipients: string[];
      }>;
    };
    const entry = body.items.find((candidate) => candidate.itemId === itemId);
    expect(entry).toBeTruthy();
    expect(entry?.status).toBe('SKIPPED');
    expect(entry?.attempts).toBeGreaterThan(0);

    // Configurar destinatario y reintentar: el fallo queda recuperable.
    const recipient = await fetch(`${apiUrl}/api/v1/admin/notification-recipients`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': mtdOrganizationId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        notificationType: 'DISPENSATION_LOCATION_ASSIGNED',
        organizationId: olpOrganizationId,
        email: 'olp-recuperable@example.test',
      }),
    });
    expect(recipient.status).toBe(201);
    const notificationId = entry?.id;
    if (!notificationId) throw new Error('Expected notification id');
    const retry = await fetch(`${apiUrl}/api/v1/admin/notifications/${notificationId}/retry`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'x-organization-id': mtdOrganizationId,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(retry.status).toBe(202);
    await waitForNotificationCount('id = $1', [notificationId], 'SENT', 1);
    const retried = await database.query<{ status: string; gmail_message_id: string | null }>(
      'select status, gmail_message_id from notifications where id = $1',
      [notificationId],
    );
    expect(retried.rows[0]?.status).toBe('SENT');
    expect(retried.rows[0]?.gmail_message_id).toBeTruthy();
  });

  it('expone el lugar y el estado derivado en lectura y permite la descarga completa de MEDICARTE', { timeout: 60_000 }, async () => {
    const itemId = await confirmReadyItem('read');
    const keyRows = await database.query<{ authorization_key: string }>(
      'select authorization_key from authorization_items where id = $1',
      [itemId],
    );
    const authorizationKey = keyRows.rows[0]?.authorization_key;
    if (!authorizationKey) throw new Error('Expected authorization key');
    const [numero] = authorizationKey.split(':');
    const batch = await createBulkBatch(
      medicarteToken,
      medicarteOrganizationId,
      locationCsv([{ authorizationKey, location: 'Calle lectura 5' }]),
    );
    const batchId = ((await batch.json()) as { id: string }).id;
    await waitForBulkBatch(medicarteToken, medicarteOrganizationId, batchId);

    const detail = await fetch(`${apiUrl}/api/v1/authorization-items/${itemId}`, {
      headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      item: { lugarDispensacion: string | null; applicationSiteStatus: string };
    };
    expect(detailBody.item).toMatchObject({
      lugarDispensacion: 'Calle lectura 5',
      applicationSiteStatus: 'ASSIGNED',
    });

    // Descarga on-demand de la base completa para MEDICARTE.
    const exportResponse = await fetch(
      `${apiUrl}/api/v1/operational-exports/authorization-items?operationType=ASSIGN_DISPENSATION_LOCATION&format=csv`,
      {
        headers: {
          authorization: `Bearer ${medicarteToken}`,
          'x-organization-id': medicarteOrganizationId,
        },
      },
    );
    expect(exportResponse.status).toBe(200);
    const csv = await exportResponse.text();
    expect(csv).toContain('lugar_dispensacion');
    expect(csv).toContain('application_site_status');
    expect(csv).toContain(numero);
    expect(csv).toContain('NOMBRE_PACIENTE');

    // OLP no puede descargar la base de la etapa de MEDICARTE en esta fase.
    const forbiddenExport = await fetch(
      `${apiUrl}/api/v1/operational-exports/authorization-items?operationType=ASSIGN_DISPENSATION_LOCATION&format=csv`,
      {
        headers: { authorization: `Bearer ${olpToken}`, 'x-organization-id': olpOrganizationId },
      },
    );
    expect(forbiddenExport.status).toBe(403);

    const exportAudits = await database.query<{ action: string }>(
      `select action from audit_events where action = 'OPERATIONAL_EXPORT_CREATED'`,
    );
    expect(exportAudits.rows.length).toBeGreaterThan(0);

    // Reporte del lote on-demand con resultado por fila.
    const report = await fetch(`${apiUrl}/api/v1/bulk-updates/${batchId}/report`, {
      headers: {
        authorization: `Bearer ${medicarteToken}`,
        'x-organization-id': medicarteOrganizationId,
      },
    });
    expect(report.status).toBe(200);
    expect(await report.text()).toContain('ROW_UPDATED');
  });
});
