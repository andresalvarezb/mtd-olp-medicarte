import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '@authorization/database';
import { currentBogotaDate } from '@authorization/domain';
import type { Scope } from '../../apps/api/src/common/request-scope';
import { ExportablesService } from '../../apps/api/src/exportables/exportables.service';
import { PurchaseOrderImportService } from '../../apps/api/src/purchase-orders/purchase-order-import.service';
import { ORGANIZATION_IDS } from './helpers/auth';

const database = createDatabase(
  process.env.DATABASE_URL ??
    'postgresql://authorization:authorization@localhost:25432/authorization_test_integration',
);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const product = `OC-DOC-${suffix}`;
const document = `00${suffix}`;
const missingDocument = `MISSING-${suffix}`;
const keys = ['A', 'B', 'C'].map((label) => `OC-DOC-${suffix}-${label}|${product}`);
const newOrder = `OC-DOC-NEW-${suffix}`;
const oldOrder = `OC-DOC-OLD-${suffix}`;
const authorizationIds: string[] = [];
const orderIds: string[] = [];
let adminId = '';
let batchId = '';
let patientId = '';
let pointId = '';

function scope(): Scope {
  return {
    organizationId: ORGANIZATION_IDS.MTD,
    organizationCode: 'MTD',
    userId: adminId,
    correlationId: randomUUID(),
    readSensitive: true,
    isFoundationAdmin: true,
    canCrossOrganizationOperationalExport: true,
    pointAccessKind: 'unrestricted',
  };
}

function uploaded(buffer: Buffer) {
  return {
    originalname: `oc-doc-${suffix}.xlsx`,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  };
}

beforeAll(async () => {
  const user = await database.pool.query<{ id: string }>(
    "select id from users where username = 'foundation-admin'",
  );
  adminId = user.rows[0]?.id ?? '';
  if (!adminId) throw new Error('TEST_ADMIN_NOT_FOUND');

  const batch = await database.pool.query<{ id: string }>(
    `insert into import_batches (
       organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
       processor_version, status, total_rows, valid_rows, confirmed_rows,
       started_at, completed_at, confirmed_at
     ) values ($1, $2, $3, 'application/json', 1, $4, 1, 'COMPLETED', 3, 3, 3,
       now(), now(), now()) returning id`,
    [ORGANIZATION_IDS.MTD, adminId, `oc-doc-${suffix}.json`, randomUUID().replaceAll('-', '').repeat(2)],
  );
  batchId = batch.rows[0]!.id;

  const point = await database.pool.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, active, created_by)
     values ($1, $2, $3, true, $4) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, `OC-DOC-${suffix}`, `Test OC ${suffix}`, adminId],
  );
  pointId = point.rows[0]!.id;

  await database.pool.query(
    `insert into tariff_annex_products (
       codigo_producto, tarifa_unidad, descripcion_generica, consecutivo_invima_presentacion,
       tipo_inclusion, active, organization_id, created_by, updated_by
     ) values ($1, '10.00', 'Producto prueba', 'OC-DOC-PRESENTATION',
       'PBS', true, $2, $3, $3)`,
    [product, ORGANIZATION_IDS.MTD, adminId],
  );

  const patient = await database.pool.query<{ id: string }>(
    `insert into patients (identification_type_raw, identification_value_raw)
     values ('CC', $1) returning id`,
    [document],
  );
  patientId = patient.rows[0]!.id;

  await database.pool.query(
    `insert into patient_default_dispensing_points (
       patient_document, dispensing_point_id, created_by, updated_by
     ) values ($1, $3, $4, $4), ($2, $3, $4, $4)`,
    [document, missingDocument, pointId, adminId],
  );

  for (const [index, key] of keys.entries()) {
    const number = key.split('|')[0]!;
    const sourceDocument = index < 2 ? document : missingDocument;
    const authorization = await database.pool.query<{ id: string }>(
      `insert into authorization_items (
         numero_autorizacion, codigo_medicamento, authorization_key, source_data,
         patient_id, source_status_normalized, source_prescripcion_normalized,
         no_prescripcion, enablement_status, coverage_type, direction_status,
         coverage_rule_version, tariff_membership_status, tariff_membership_evaluated_at,
         created_from_batch_id
       ) values (
         $1, $2, $3, $4::jsonb, $5, '5', '', '', 'ENABLED', 'PBS',
         'NOT_APPLICABLE', 'RF-OC-EXPORT-001', 'LISTED', now(), $6
       ) returning id`,
      [
        number,
        product,
        key,
        JSON.stringify({
          NUMERO_AUTORIZACION: number,
          CODIGO_COMERCIAL: product,
          CANTIDAD: '2',
          FECHA_ASIGNACION: currentBogotaDate(),
          FECHA_FINAL_VIGENCIA: '20991231',
          IDENTIFICACION_PACIENTE: sourceDocument,
        }),
        index < 2 ? patientId : null,
        batchId,
      ],
    );
    const id = authorization.rows[0]!.id;
    authorizationIds.push(id);
    await database.pool.query(
      `insert into authorization_item_organizations (authorization_item_id, organization_id)
       values ($1, $2)`,
      [id, ORGANIZATION_IDS.MTD],
    );
  }
}, 30_000);

afterAll(async () => {
  try {
    if (orderIds.length) {
      await database.pool.query(
        `delete from purchase_order_authorization_sources where purchase_order_line_id in
         (select id from purchase_order_lines where purchase_order_id = any($1::uuid[]))`,
        [orderIds],
      );
      await database.pool.query(
        'delete from purchase_order_lines where purchase_order_id = any($1::uuid[])',
        [orderIds],
      );
      await database.pool.query('delete from purchase_orders where id = any($1::uuid[])', [orderIds]);
    }
    if (authorizationIds.length) {
      await database.pool.query(
        'delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])',
        [authorizationIds],
      );
      await database.pool.query('delete from authorization_items where id = any($1::uuid[])', [authorizationIds]);
    }
    await database.pool.query(
      'delete from patient_default_dispensing_points where patient_document = any($1::text[])',
      [[document, missingDocument]],
    );
    if (patientId) await database.pool.query('delete from patients where id = $1', [patientId]);
    if (batchId) await database.pool.query('delete from import_batches where id = $1', [batchId]);
    await database.pool.query('delete from tariff_annex_products where codigo_producto = $1', [product]);
    if (pointId) await database.pool.query('delete from dispensing_points where id = $1', [pointId]);
  } finally {
    await database.pool.end();
  }
}, 30_000);

describe('RF-OC-EXPORT-001 — exportación e importación con PostgreSQL', () => {
  it('mantiene documento, filas y columnas y acepta también el formato anterior', async () => {
    const exporter = new ExportablesService(database);
    const importer = new PurchaseOrderImportService(database, undefined as never);
    const exported = await exporter.purchaseOrderCandidates(scope());
    const book = XLSX.read(exported.content, { type: 'buffer' });
    const sheet = book.Sheets.ORDENES_COMPRA!;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const rows = matrix.slice(1).filter((row) => keys.includes(String(row[1])));

    expect(matrix[0]).toEqual([
      'CLAVE_AUTORIZACION_ORIGEN', 'CLAVE_AUTORIZACION_DESTINO', 'DOCUMENTO PACIENTE',
      'OC', 'CODIGO_PRODUCTO', 'CANTIDAD', 'FECHA_ASIGNACION', 'FECHA_FINAL_VIGENCIA', 'PUNTO',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => [row[1], row[2], row[4], row[5], row[8]])).toEqual([
      [keys[0], document, product, 2, `Test OC ${suffix}`],
      [keys[1], document, product, 2, `Test OC ${suffix}`],
      [keys[2], '', product, 2, `Test OC ${suffix}`],
    ]);
    for (const row of rows.slice(0, 2)) {
      const cell = sheet[`C${matrix.indexOf(row) + 1}`] as { t: string; v: string };
      expect([cell.t, cell.v]).toEqual(['s', document]);
    }

    const newSheet = XLSX.utils.aoa_to_sheet([
      matrix[0]!,
      ...rows.slice(0, 2).map((row) => {
        const values = [...row];
        values[3] = newOrder;
        return values;
      }),
    ]);
    book.Sheets.ORDENES_COMPRA = newSheet;
    let buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const imported = await importer.import(uploaded(buffer), scope());
    expect([imported.acceptedRows, imported.rejectedRows, imported.createdOrders]).toEqual([2, 0, 1]);
    orderIds.push(imported.results[0]!.purchaseOrderId!);

    const previous = XLSX.read(exported.content, { type: 'buffer' });
    const previousRow = [...rows[2]!];
    previousRow.splice(2, 1);
    previousRow[2] = oldOrder;
    const previousHeaders = [...matrix[0]!];
    previousHeaders.splice(2, 1);
    previous.Sheets.ORDENES_COMPRA = XLSX.utils.aoa_to_sheet([previousHeaders, previousRow]);
    buffer = XLSX.write(previous, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const oldImported = await importer.import(uploaded(buffer), scope());
    expect([oldImported.acceptedRows, oldImported.rejectedRows, oldImported.createdOrders]).toEqual([1, 0, 1]);
    orderIds.push(oldImported.results[0]!.purchaseOrderId!);

    const linked = await database.pool.query<{ authorization_key: string; purchase_order_code: string; quantity: number }>(
      `select ai.authorization_key, po.purchase_order_code, poas.source_quantity_snapshot::int as quantity
       from purchase_order_authorization_sources poas
       join authorization_items ai on ai.id = poas.authorization_item_id
       join purchase_order_lines pol on pol.id = poas.purchase_order_line_id
       join purchase_orders po on po.id = pol.purchase_order_id
       where ai.id = any($1::uuid[])
       order by ai.authorization_key`,
      [authorizationIds],
    );
    expect(linked.rows).toEqual([
      { authorization_key: keys[0], purchase_order_code: newOrder, quantity: 2 },
      { authorization_key: keys[1], purchase_order_code: newOrder, quantity: 2 },
      { authorization_key: keys[2], purchase_order_code: oldOrder, quantity: 2 },
    ]);
  });
});
