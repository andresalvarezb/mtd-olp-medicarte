import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { createDatabase } from '@authorization/database';
import { currentBogotaDate } from '@authorization/domain';

import type { Scope } from '../../apps/api/src/common/request-scope';
import { PurchaseOrderImportService } from '../../apps/api/src/purchase-orders/purchase-order-import.service';
import { ORGANIZATION_IDS } from './helpers/auth';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://authorization:authorization@localhost:25432/authorization_test_integration';
const database = createDatabase(databaseUrl);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const product = `PO-ROW-${suffix}`;
const importBatchCode = `PO-ROW-${suffix}.json`;
const chapineroCode = `PO-ROW-CH-${suffix}`;
const ibagueCode = `PO-ROW-IB-${suffix}`;
const purchaseOrderCodes = [`PO-ROW-MIX-${suffix}`, `PO-ROW-CUM-${suffix}`, `PO-ROW-CON-${suffix}`];
const atomicPurchaseOrderCode = `PO-ROW-ATOMIC-${suffix}`;
const atomicTrigger = `po_row_fail_${suffix.toLowerCase()}`;
const atomicFunction = `po_row_fail_fn_${suffix.toLowerCase()}`;

let adminId = '';
let importBatchId = '';
let chapineroPointId = '';
let ibaguePointId = '';
const orderIds: string[] = [];
const authorizationIds: string[] = [];
const patientDocuments: string[] = [];

function scope(correlationId = randomUUID()): Scope {
  return {
    organizationId: ORGANIZATION_IDS.MTD,
    organizationCode: 'MTD',
    userId: adminId,
    correlationId,
    readSensitive: true,
    isFoundationAdmin: true,
    canCrossOrganizationOperationalExport: true,
    pointAccessKind: 'unrestricted',
  };
}

async function insertAuthorization(
  label: string,
  dispensingPointId: string,
): Promise<{ id: string; key: string }> {
  const number = `${suffix}-${label}`;
  const document = `TEST-PO-ROW-${suffix}-${label}`;
  const key = `${number}:${product}`;
  const result = await database.pool.query<{ id: string }>(
    `insert into authorization_items (
       numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       tariff_membership_status, tariff_membership_evaluated_at, created_from_batch_id
       ) values (
       $1, $2, $3, $4::jsonb, '5', '9999999999999', '9999999999',
       'ENABLED', 'PBS', 'NOT_APPLICABLE', 'TEST-PO-ROW', 'LISTED', now(), $5
     ) returning id`,
    [
      number,
      product,
      key,
      JSON.stringify({
        NUMERO_AUTORIZACION: number,
        CODIGO_COMERCIAL: product,
        CANTIDAD: '1',
        FECHA_ASIGNACION: currentBogotaDate(),
        FECHA_FINAL_VIGENCIA: '20991231',
        IDENTIFICACION_PACIENTE: document,
      }),
      importBatchId,
    ],
  );
  const id = result.rows[0]!.id;
  authorizationIds.push(id);
  patientDocuments.push(document);

  await database.pool.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2) on conflict do nothing`,
    [id, ORGANIZATION_IDS.MTD],
  );
  await database.pool.query(
    `insert into patient_default_dispensing_points (
       patient_document, dispensing_point_id, created_by, updated_by
     ) values ($1, $2, $3, $3)`,
    [document, dispensingPointId, adminId],
  );
  return { id, key };
}

async function insertOrderWithReceipt(code: string, quantity: number): Promise<string> {
  const order = await database.pool.query<{ id: string }>(
    `insert into purchase_orders (
       purchase_order_code, origin, planning_period_id, order_type, status,
       issued_at, issued_by, created_by, updated_by
     ) values ($1, 'DIRECT_AUTHORIZATION', null, 'STANDARD', 'RECEIVED', now(), $2, $2, $2)
     returning id`,
    [code, adminId],
  );
  const orderId = order.rows[0]!.id;
  orderIds.push(orderId);

  const line = await database.pool.query<{ id: string }>(
    `insert into purchase_order_lines (
       purchase_order_id, commercial_code, provenance, product_description, presentation,
       dispensing_point_id, requested_quantity, olp_managed_quantity, accepted_quantity,
       requested_delivery_date, compensar_unit_rate_snapshot, tariff_snapshot_provenance,
       projected_demand_line_id, projected_demand_revision, demand_bucket
     ) values ($1, $2, 'DIRECT_AUTHORIZATION', 'Synthetic regression item', '1', $3,
       $4, $4, null, null, '10.00', 'LIVE_SNAPSHOT', null, null, null)
     returning id`,
    [orderId, product, chapineroPointId, quantity],
  );

  const receipt = await database.pool.query<{ id: string }>(
    `insert into purchase_order_receipts (purchase_order_id, confirmed_by, observation)
     values ($1, $2, 'Synthetic integration fixture') returning id`,
    [orderId, adminId],
  );
  if (quantity > 0) {
    await database.pool.query(
      `insert into purchase_order_receipt_lines (
         receipt_id, purchase_order_line_id, outcome, received_quantity, lot_number, expiration_date
       ) values ($1, $2, 'RECEIVED_COMPLETE', $3, $4, '2099-12-31')`,
      [receipt.rows[0]!.id, line.rows[0]!.id, quantity, `LOT-${suffix}-${code.slice(-3)}`],
    );
  }
  return orderId;
}

function uploadedWorkbook(rows: ReadonlyArray<readonly [string, string, number]>) {
  const service = new PurchaseOrderImportService(database, undefined as never);
  const workbook = XLSX.read(service.buildTemplate(), { type: 'buffer' });
  const sheet = workbook.Sheets.ORDENES_COMPRA!;
  XLSX.utils.sheet_add_aoa(
    sheet,
    rows.map(([authorizationKey, purchaseOrderCode, quantity]) => [
      '',
      authorizationKey,
      purchaseOrderCode,
      product,
      quantity,
    ]),
    { origin: -1 },
  );
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return {
    originalname: 'synthetic-purchase-order.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: buffer.length,
    buffer,
  };
}

async function importRows(rows: ReadonlyArray<readonly [string, string, number]>, actor = scope()) {
  const service = new PurchaseOrderImportService(database, undefined as never);
  return service.import(uploadedWorkbook(rows), actor);
}

async function countForOrder(
  table: 'inventory_authorization_allocations' | 'inventory_allocation_batches',
  orderId: string,
) {
  const query =
    table === 'inventory_authorization_allocations'
      ? `select count(*)::int as count from inventory_authorization_allocations where purchase_order_id = $1`
      : `select count(*)::int as count from inventory_allocation_batches b
       where exists (select 1 from inventory_authorization_allocations a
                     where a.batch_id = b.id and a.purchase_order_id = $1)`;
  const result = await database.pool.query<{ count: number }>(query, [orderId]);
  return Number(result.rows[0]?.count ?? 0);
}

beforeAll(async () => {
  const user = await database.pool.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );
  adminId = user.rows[0]?.id ?? '';
  if (!adminId) throw new Error('PO_ROW_TEST_ADMIN_NOT_FOUND');

  const batch = await database.pool.query<{ id: string }>(
    `insert into import_batches (
       organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
       processor_version, status, total_rows, valid_rows, confirmed_rows,
       started_at, completed_at, confirmed_at
     ) values ($1, $2, $3, 'application/json', 1, $4, 1, 'COMPLETED', 1, 1, 1,
       now(), now(), now()) returning id`,
    [ORGANIZATION_IDS.MTD, adminId, importBatchCode, randomUUID().replaceAll('-', '').repeat(2)],
  );
  importBatchId = batch.rows[0]!.id;

  const chapinero = await database.pool.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, active, created_by)
     values ($1, $2, 'Synthetic CHAPINERO', true, $3) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, chapineroCode, adminId],
  );
  chapineroPointId = chapinero.rows[0]!.id;
  const ibague = await database.pool.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, active, created_by)
     values ($1, $2, 'Synthetic IBAGUE', true, $3) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, ibagueCode, adminId],
  );
  ibaguePointId = ibague.rows[0]!.id;

  await database.pool.query(
    `insert into tariff_annex_products (
       codigo_producto, tarifa_unidad, descripcion_generica, consecutivo_invima_presentacion,
       tipo_inclusion, active, organization_id, created_by, updated_by
     ) values ($1, '10.00', 'Synthetic regression item', 'PO-ROW-PRESENTATION',
       'PBS', true, $2, $3, $3)`,
    [product, ORGANIZATION_IDS.MTD, adminId],
  );

  await insertOrderWithReceipt(purchaseOrderCodes[0]!, 2);
  await insertOrderWithReceipt(purchaseOrderCodes[1]!, 1);
  await insertOrderWithReceipt(purchaseOrderCodes[2]!, 1);
}, 30_000);

afterAll(async () => {
  try {
    await database.pool.query(
      `drop trigger if exists ${atomicTrigger} on purchase_order_authorization_sources`,
    );
    await database.pool.query(`drop function if exists ${atomicFunction}()`);

    if (orderIds.length) {
      const batches = await database.pool.query<{ id: string }>(
        `select distinct batch_id as id from inventory_authorization_allocations
         where purchase_order_id = any($1::uuid[])`,
        [orderIds],
      );
      await database.pool.query(
        `delete from inventory_authorization_allocations where purchase_order_id = any($1::uuid[])`,
        [orderIds],
      );
      if (batches.rows.length) {
        await database.pool.query(
          `delete from inventory_allocation_batches where id = any($1::uuid[])`,
          [batches.rows.map((row) => row.id)],
        );
      }
      await database.pool.query(
        `delete from purchase_order_receipt_lines where receipt_id in
           (select id from purchase_order_receipts where purchase_order_id = any($1::uuid[]))`,
        [orderIds],
      );
      await database.pool.query(
        `delete from purchase_order_receipts where purchase_order_id = any($1::uuid[])`,
        [orderIds],
      );
      await database.pool.query(
        `delete from purchase_order_lines where purchase_order_id = any($1::uuid[])`,
        [orderIds],
      );
      await database.pool.query(`delete from purchase_orders where id = any($1::uuid[])`, [
        orderIds,
      ]);
    }

    if (patientDocuments.length) {
      await database.pool.query(
        `delete from patient_default_dispensing_points where patient_document = any($1::text[])`,
        [patientDocuments],
      );
    }
    if (authorizationIds.length) {
      await database.pool.query(
        `delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])`,
        [authorizationIds],
      );
      await database.pool.query(`delete from authorization_items where id = any($1::uuid[])`, [
        authorizationIds,
      ]);
    }
    if (importBatchId)
      await database.pool.query(`delete from import_batches where id = $1`, [importBatchId]);
    if (product)
      await database.pool.query(`delete from tariff_annex_products where codigo_producto = $1`, [
        product,
      ]);
    if (chapineroPointId)
      await database.pool.query(`delete from dispensing_points where id = $1`, [chapineroPointId]);
    if (ibaguePointId)
      await database.pool.query(`delete from dispensing_points where id = $1`, [ibaguePointId]);
  } finally {
    await database.pool.end();
  }
}, 30_000);

describe('PostgreSQL — asignaciones independientes a OC existente', () => {
  it('aísla el punto incompatible, acumula disponibilidad, persiste auditoría y evita duplicar reintentos', async () => {
    const compatibleA = await insertAuthorization('MIX-A', chapineroPointId);
    const incompatible = await insertAuthorization('MIX-IBAGUE', ibaguePointId);
    const compatibleB = await insertAuthorization('MIX-B', chapineroPointId);
    const correlationId = randomUUID();

    const result = await importRows(
      [
        [incompatible.key, purchaseOrderCodes[0]!, 1],
        [compatibleA.key, purchaseOrderCodes[0]!, 1],
        [compatibleB.key, purchaseOrderCodes[0]!, 1],
      ],
      scope(correlationId),
    );

    expect(result.results.map((row) => [row.status, row.errorCode])).toEqual([
      ['REJECTED', 'PURCHASE_ORDER_PRODUCT_POINT_MISMATCH'],
      ['ACCEPTED', null],
      ['ACCEPTED', null],
    ]);
    expect(result.acceptedRows).toBe(2);
    expect(result.rejectedRows).toBe(1);

    const orderId = orderIds[0]!;
    const allocations = await database.pool.query<{
      authorization_item_id: string;
      allocated_quantity: number;
    }>(
      `select authorization_item_id, allocated_quantity
       from inventory_authorization_allocations where purchase_order_id = $1 order by created_at, id`,
      [orderId],
    );
    expect(allocations.rows).toHaveLength(2);
    expect(allocations.rows.map((row) => row.authorization_item_id).sort()).toEqual(
      [compatibleA.id, compatibleB.id].sort(),
    );
    expect(allocations.rows.reduce((sum, row) => sum + Number(row.allocated_quantity), 0)).toBe(2);

    const audits = await database.pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where correlation_id = $1 and action = 'PURCHASE_ORDER_AVAILABLE_ASSIGNED'`,
      [correlationId],
    );
    expect(audits.rows[0]?.count).toBe(2);

    const retry = await importRows(
      [[compatibleA.key, purchaseOrderCodes[0]!, 1]],
      scope(randomUUID()),
    );
    expect(retry.results[0]).toMatchObject({
      status: 'REJECTED',
      errorCode: 'PURCHASE_ORDER_DESTINATION_ALREADY_COVERED',
    });
    expect(await countForOrder('inventory_authorization_allocations', orderId)).toBe(2);
    expect(await countForOrder('inventory_allocation_batches', orderId)).toBe(2);
  });

  it('recalcula el saldo tras cada fila y no asigna más que la recepción física', async () => {
    const first = await insertAuthorization('CUM-A', chapineroPointId);
    const second = await insertAuthorization('CUM-B', chapineroPointId);
    const result = await importRows([
      [first.key, purchaseOrderCodes[1]!, 1],
      [second.key, purchaseOrderCodes[1]!, 1],
    ]);

    expect(result.acceptedRows).toBe(1);
    expect(result.rejectedRows).toBe(1);
    expect(result.results[0]?.status).toBe('ACCEPTED');
    expect(result.results[1]).toMatchObject({
      status: 'REJECTED',
      errorCode: 'PURCHASE_ORDER_PENDING_COMMITMENT_INSUFFICIENT',
    });
    expect(await countForOrder('inventory_authorization_allocations', orderIds[1]!)).toBe(1);
    const batches = await database.pool.query<{ allocated_quantity: number; total_rows: number }>(
      `select b.allocated_quantity, b.total_rows
       from inventory_allocation_batches b
       join inventory_authorization_allocations a on a.batch_id = b.id
       where a.purchase_order_id = $1`,
      [orderIds[1]],
    );
    expect(batches.rows).toEqual([{ allocated_quantity: 1, total_rows: 1 }]);
  });

  it('serializa importaciones concurrentes para proteger una unidad compartida', async () => {
    const first = await insertAuthorization('CON-A', chapineroPointId);
    const second = await insertAuthorization('CON-B', chapineroPointId);
    const attempts = await Promise.all([
      importRows([[first.key, purchaseOrderCodes[2]!, 1]]),
      importRows([[second.key, purchaseOrderCodes[2]!, 1]]),
    ]);

    expect(attempts.map((result) => result.acceptedRows).sort()).toEqual([0, 1]);
    expect(attempts.map((result) => result.rejectedRows).sort()).toEqual([0, 1]);
    const rejected = attempts
      .flatMap((result) => result.results)
      .find((row) => row.status === 'REJECTED');
    expect(rejected?.errorCode).toBe('PURCHASE_ORDER_PENDING_COMMITMENT_INSUFFICIENT');
    expect(await countForOrder('inventory_authorization_allocations', orderIds[2]!)).toBe(1);

    const audit = await database.pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where resource_id = $1 and action = 'PURCHASE_ORDER_AVAILABLE_ASSIGNED'`,
      [orderIds[2]],
    );
    expect(audit.rows[0]?.count).toBe(1);
  });

  it('revierte en PostgreSQL la nueva OC completa si falla una fuente después de crear la primera línea', async () => {
    const first = await insertAuthorization('ATOMIC-A', chapineroPointId);
    const second = await insertAuthorization('ATOMIC-B', chapineroPointId);
    await database.pool.query(`drop function if exists ${atomicFunction}()`);
    await database.pool.query(`
      create function ${atomicFunction}() returns trigger language plpgsql as $$
      begin
        if new.authorization_item_id = '${second.id}'::uuid then
          raise exception 'PO_ROW_FORCED_SOURCE_FAILURE';
        end if;
        return new;
      end;
      $$
    `);
    await database.pool.query(`
      create trigger ${atomicTrigger}
      before insert on purchase_order_authorization_sources
      for each row execute function ${atomicFunction}()
    `);

    try {
      const result = await importRows([
        [first.key, atomicPurchaseOrderCode, 1],
        [second.key, atomicPurchaseOrderCode, 1],
      ]);
      expect(result.acceptedRows).toBe(0);
      expect(result.rejectedRows).toBe(2);
      expect(result.results.every((row) => row.status === 'REJECTED')).toBe(true);

      const persisted = await database.pool.query<{
        orders: number;
        lines: number;
        sources: number;
        audits: number;
      }>(
        `select
           (select count(*)::int from purchase_orders where purchase_order_code = $1) as orders,
           (select count(*)::int from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id where po.purchase_order_code = $1) as lines,
           (select count(*)::int from purchase_order_authorization_sources poas join purchase_order_lines pol on pol.id = poas.purchase_order_line_id join purchase_orders po on po.id = pol.purchase_order_id where po.purchase_order_code = $1) as sources,
           (select count(*)::int from audit_events where action = 'PURCHASE_ORDER_DIRECT_AUTHORIZATION_IMPORTED' and resource_id in (select id::text from purchase_orders where purchase_order_code = $1)) as audits`,
        [atomicPurchaseOrderCode],
      );
      expect(persisted.rows[0]).toEqual({ orders: 0, lines: 0, sources: 0, audits: 0 });
    } finally {
      await database.pool.query(
        `drop trigger if exists ${atomicTrigger} on purchase_order_authorization_sources`,
      );
      await database.pool.query(`drop function if exists ${atomicFunction}()`);
    }
  });
});
