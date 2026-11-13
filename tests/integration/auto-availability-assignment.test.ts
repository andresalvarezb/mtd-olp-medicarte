import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '@authorization/database';
import { currentBogotaDate } from '@authorization/domain';

import type { Scope } from '../../apps/api/src/common/request-scope';
import { InventoryAvailabilityRepository } from '../../apps/api/src/inventory/inventory-availability.repository';
import { ORGANIZATION_IDS } from './helpers/auth';
import { AccessService } from '../../apps/api/src/identity/access.service';
import { InventoryAvailabilityReconciliationService } from '../../apps/api/src/inventory/inventory-availability-reconciliation.service';
import { ReceiptRepository } from '../../apps/api/src/receipts/receipt.repository';
import type { InventoryRepository } from '../../apps/api/src/inventory/inventory.repository';
import type { HistoricalPurchaseOrderSourceRecoveryService } from '../../apps/api/src/legacy/historical-purchase-order-source-recovery.service';

const integrationTarget = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (
  !['localhost', '127.0.0.1'].includes(integrationTarget.hostname) ||
  integrationTarget.pathname !== '/authorization_test_integration'
) {
  throw new Error('AUTO_AVAILABILITY_TEST_REFUSES_NONLOCAL_OR_NONTEST_DATABASE');
}
const database = createDatabase(process.env.DATABASE_URL!);
const repository = new InventoryAvailabilityRepository(database);
const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const product = `AUTO-AVAIL-${suffix}`;
const authorizationNumber = `AUTO-AVAIL-${suffix}`;
const authorizationKey = `${authorizationNumber}|${product}`;
const patientDocument = `TEST-AUTO-AVAIL-${suffix}`;
const pointCode = `AUTO-AVAIL-PT-${suffix}`;
const orderCodes = [`AUTO-AVAIL-FEFO-${suffix}`, `AUTO-AVAIL-LATER-${suffix}`];
const correlationId = randomUUID();

let userId = '';
let importBatchId = '';
let pointId = '';
let authorizationItemId = '';
const purchaseOrderIds: string[] = [];

function scope(): Scope {
  return {
    organizationId: ORGANIZATION_IDS.MTD,
    organizationCode: 'MTD',
    userId,
    correlationId,
    readSensitive: true,
    isFoundationAdmin: true,
    canCrossOrganizationOperationalExport: true,
    pointAccessKind: 'unrestricted',
  };
}

async function insertOrderWithReceipt(input: {
  code: string;
  quantity: number;
  expirationDate: string;
}): Promise<void> {
  const order = await database.pool.query<{ id: string }>(
    `insert into purchase_orders (
       purchase_order_code, origin, planning_period_id, order_type, status,
       issued_at, issued_by, created_by, updated_by
     ) values ($1, 'DIRECT_AUTHORIZATION', null, 'STANDARD', 'RECEIVED', now(), $2, $2, $2)
     returning id`,
    [input.code, userId],
  );
  const purchaseOrderId = order.rows[0]!.id;
  purchaseOrderIds.push(purchaseOrderId);

  const line = await database.pool.query<{ id: string }>(
    `insert into purchase_order_lines (
       purchase_order_id, commercial_code, provenance, product_description, presentation,
       dispensing_point_id, requested_quantity, olp_managed_quantity, accepted_quantity,
       requested_delivery_date, compensar_unit_rate_snapshot, tariff_snapshot_provenance,
       projected_demand_line_id, projected_demand_revision, demand_bucket
     ) values ($1, $2, 'DIRECT_AUTHORIZATION', 'Synthetic auto-availability item', '1', $3,
       $4, $4, null, null, '10.00', 'LIVE_SNAPSHOT', null, null, null)
     returning id`,
    [purchaseOrderId, product, pointId, input.quantity],
  );
  const receipt = await database.pool.query<{ id: string }>(
    `insert into purchase_order_receipts (purchase_order_id, confirmed_by, observation)
     values ($1, $2, 'Synthetic auto-availability fixture') returning id`,
    [purchaseOrderId, userId],
  );
  await database.pool.query(
    `insert into purchase_order_receipt_lines (
       receipt_id, purchase_order_line_id, outcome, received_quantity, lot_number, expiration_date
     ) values ($1, $2, 'RECEIVED_COMPLETE', $3, $4, $5::date)`,
    [receipt.rows[0]!.id, line.rows[0]!.id, input.quantity, `LOT-${suffix}-${input.code.slice(-5)}`, input.expirationDate],
  );
}

beforeAll(async () => {
  const user = await database.pool.query<{ id: string }>(
    `select id from users where username = 'foundation-admin'`,
  );
  userId = user.rows[0]?.id ?? '';
  if (!userId) throw new Error('AUTO_AVAILABILITY_TEST_ADMIN_NOT_FOUND');

  const batch = await database.pool.query<{ id: string }>(
    `insert into import_batches (
       organization_id, created_by, original_filename, mime_type, size_bytes, sha256,
       processor_version, status, total_rows, valid_rows, confirmed_rows,
       started_at, completed_at, confirmed_at
     ) values ($1, $2, $3, 'application/json', 1, $4, 1, 'COMPLETED', 1, 1, 1,
       now(), now(), now()) returning id`,
    [ORGANIZATION_IDS.MTD, userId, `${product}.json`, randomUUID().replaceAll('-', '').repeat(2)],
  );
  importBatchId = batch.rows[0]!.id;

  const point = await database.pool.query<{ id: string }>(
    `insert into dispensing_points (organization_id, code, name, active, created_by)
     values ($1, $2, 'Synthetic auto-availability point', true, $3) returning id`,
    [ORGANIZATION_IDS.MEDICARTE, pointCode, userId],
  );
  pointId = point.rows[0]!.id;

  const authorization = await database.pool.query<{ id: string }>(
    `insert into authorization_items (
       numero_autorizacion, codigo_medicamento, authorization_key, source_data,
       source_status_normalized, source_prescripcion_normalized, no_prescripcion,
       enablement_status, coverage_type, direction_status, coverage_rule_version,
       tariff_membership_status, tariff_membership_evaluated_at, created_from_batch_id
     ) values ($1, $2, $3, $4::jsonb, '5', '9999999999999', '9999999999',
       'ENABLED', 'PBS', 'NOT_APPLICABLE', 'TEST-AUTO-AVAILABILITY', 'LISTED', now(), $5)
     returning id`,
    [
      authorizationNumber,
      product,
      authorizationKey,
      JSON.stringify({
        NUMERO_AUTORIZACION: authorizationNumber,
        CODIGO_COMERCIAL: product,
        CANTIDAD: '6',
        FECHA_ASIGNACION: currentBogotaDate(),
        FECHA_FINAL_VIGENCIA: '20261215',
        IDENTIFICACION_PACIENTE: patientDocument,
      }),
      importBatchId,
    ],
  );
  authorizationItemId = authorization.rows[0]!.id;

  await database.pool.query(
    `insert into authorization_item_organizations (authorization_item_id, organization_id)
     values ($1, $2) on conflict do nothing`,
    [authorizationItemId, ORGANIZATION_IDS.MTD],
  );
  await database.pool.query(
    `insert into patient_default_dispensing_points (
       patient_document, dispensing_point_id, active, created_by, updated_by
     ) values ($1, $2, true, $3, $3)`,
    [patientDocument, pointId, userId],
  );

  await insertOrderWithReceipt({
    code: orderCodes[0]!,
    quantity: 2,
    expirationDate: '2027-01-31',
  });
  await insertOrderWithReceipt({
    code: orderCodes[1]!,
    quantity: 4,
    expirationDate: '2027-02-28',
  });
}, 30_000);

afterAll(async () => {
  try {
    if (purchaseOrderIds.length) {
      await database.pool.query(
        `delete from inventory_authorization_allocations where purchase_order_id = any($1::uuid[])`,
        [purchaseOrderIds],
      );
    }
    await database.pool.query(`delete from inventory_allocation_batches where correlation_id = $1`, [correlationId]);
    if (authorizationItemId) {
      await database.pool.query(
        `delete from purchase_order_authorization_sources where authorization_item_id = $1`,
        [authorizationItemId],
      );
      await database.pool.query(
        `delete from patient_default_dispensing_points where patient_document = any($1::text[])`,
        [[patientDocument]],
      );
      await database.pool.query(
        `delete from authorization_item_organizations where authorization_item_id = any($1::uuid[])`,
        [[authorizationItemId]],
      );
      await database.pool.query(
        `delete from authorization_items where id = any($1::uuid[])`,
        [[authorizationItemId]],
      );
    }
    if (purchaseOrderIds.length) {
      await database.pool.query(`delete from purchase_order_receipts where purchase_order_id = any($1::uuid[])`, [purchaseOrderIds]);
      await database.pool.query(`delete from purchase_order_lines where purchase_order_id = any($1::uuid[])`, [purchaseOrderIds]);
      await database.pool.query(`delete from purchase_orders where id = any($1::uuid[])`, [purchaseOrderIds]);
    }
    if (importBatchId) await database.pool.query(`delete from import_batches where id = $1`, [importBatchId]);
    if (pointId) await database.pool.query(`delete from dispensing_points where id = $1`, [pointId]);
  } finally {
    await database.pool.end();
  }
});

describe.sequential('automatic assignment of available inventory', () => {
  it('completes one AUTO from multiple OCs in FEFO order and does not duplicate on replay', async () => {
    const first = await database.db.transaction((tx) =>
      repository.assignAutomaticallyInTx(tx, scope(), 'STOCK_BECAME_AVAILABLE', {
        commercialCodes: [product],
        dispensingPointIds: [pointId],
      }),
    );

    expect(first).toMatchObject({
      assignedQuantity: 6,
      assignedAuthorizationKeys: [authorizationKey],
      unmatchedStock: [],
    });

    const allocations = await database.pool.query<{
      purchase_order_code: string;
      allocated_quantity: number;
      batch_source: string;
    }>(
      `select po.purchase_order_code, iaa.allocated_quantity, batch.source as batch_source
       from inventory_authorization_allocations iaa
       join purchase_orders po on po.id = iaa.purchase_order_id
       join inventory_allocation_batches batch on batch.id = iaa.batch_id
       where iaa.authorization_item_id = $1
       order by po.purchase_order_code`,
      [authorizationItemId],
    );
    expect(allocations.rows).toEqual([
      { purchase_order_code: orderCodes[0], allocated_quantity: 2, batch_source: 'AUTO' },
      { purchase_order_code: orderCodes[1], allocated_quantity: 4, batch_source: 'AUTO' },
    ]);

    const replay = await database.db.transaction((tx) =>
      repository.assignAutomaticallyInTx(tx, scope(), 'STOCK_BECAME_AVAILABLE', {
        commercialCodes: [product],
        dispensingPointIds: [pointId],
      }),
    );
    expect(replay.assignedQuantity).toBe(0);

    await database.pool.query(
      `update inventory_authorization_allocations
       set released_quantity = allocated_quantity, status = 'RELEASED', updated_by = $2, updated_at = now()
       where authorization_item_id = $1`,
      [authorizationItemId, userId],
    );

    const releaseAssignment = await database.db.transaction((tx) =>
      repository.assignAutomaticallyInTx(tx, scope(), 'RESERVATION_RELEASED', {
        commercialCodes: [product],
        dispensingPointIds: [pointId],
      }),
    );
    expect(releaseAssignment).toMatchObject({
      assignedQuantity: 6,
      assignedAuthorizationKeys: [authorizationKey],
      unmatchedStock: [],
    });

    const reassignedAllocations = await database.pool.query<{ allocated_quantity: number }>(
      `select allocated_quantity from inventory_authorization_allocations
       where authorization_item_id = $1 order by created_at, id`,
      [authorizationItemId],
    );
    expect(reassignedAllocations.rows.reduce((total, row) => total + row.allocated_quantity, 0)).toBe(12);

    const count = await database.pool.query<{ count: number }>(
      `select count(*)::int as count from inventory_authorization_allocations
       where authorization_item_id = $1`,
      [authorizationItemId],
    );
    expect(count.rows[0]?.count).toBe(4);
  });
  it('no duplica una AUTO cubierta cuando llega su OC original', async () => {
    const originalCode = `AUTO-AVAIL-ORIGIN-${suffix}`;
    await insertOrderWithReceipt({
      code: originalCode,
      quantity: 6,
      expirationDate: '2027-12-31',
    });

    const originalId = purchaseOrderIds.at(-1)!;
    const lines = await database.pool.query<{ id: string }>(
      `select id from purchase_order_lines
       where purchase_order_id = $1 and commercial_code = $2`,
      [originalId, product],
    );

    await database.pool.query(
      `insert into purchase_order_authorization_sources (
        purchase_order_line_id, authorization_item_id,
        projected_demand_line_id, projected_demand_revision,
        source_quantity_snapshot
      ) values ($1, $2, $3, 1, 6)`,
      [lines.rows[0]!.id, authorizationItemId, randomUUID()],
    );

    const recovery = {
      recoverForPurchaseOrder: () => Promise.resolve(),
    } as unknown as HistoricalPurchaseOrderSourceRecoveryService;

    const receipts = new ReceiptRepository(
      database,
      {} as unknown as InventoryRepository,
      recovery,
      repository,
    );

    const result = await receipts.reconcilePurchaseOrderAllocations(
      originalId, scope(),
    );
    expect(result.assignedNow).toBe(0);
    expect(result.unassignedNow).toBe(6);

    const replay = await receipts.reconcilePurchaseOrderAllocations(
      originalId, scope(),
    );
    expect(replay.assignedNow).toBe(0);

    const balances = await database.pool.query<{
      original_reserved: number;
      other_reserved: number;
    }>(
      `select
        (select coalesce(sum(greatest(
          allocated_quantity-consumed_quantity-released_quantity,0
        )),0)::int
         from inventory_authorization_allocations
         where authorization_item_id=$1
           and purchase_order_id=$2
           and status in ('ALLOCATED','PARTIALLY_CONSUMED')
        ) as original_reserved,
        (select coalesce(sum(greatest(
          allocated_quantity-consumed_quantity-released_quantity,0
        )),0)::int
         from inventory_authorization_allocations
         where authorization_item_id=$1
           and purchase_order_id<>$2
           and status in ('ALLOCATED','PARTIALLY_CONSUMED')
        ) as other_reserved`,
      [authorizationItemId, originalId],
    );

    expect(balances.rows[0]).toEqual({
      original_reserved: 0,
      other_reserved: 6,
    });
  });

  it('reconciles pre-existing stock without a receipt event, previews without writes, and survives concurrent replay', async () => {
    // This fixture is synthetic and belongs only to the guarded integration database.
    // Release its prior test reservations, never production allocations.
    await database.pool.query(
      `update inventory_authorization_allocations
       set released_quantity = allocated_quantity, status = 'RELEASED',
           updated_by = $2, updated_at = now()
       where authorization_item_id = $1 and consumed_quantity = 0`,
      [authorizationItemId, userId],
    );
    const reconciliation = new InventoryAvailabilityReconciliationService(repository, new AccessService(database));
    const actor = { userId, organizationId: ORGANIZATION_IDS.MTD, correlationId };
    const options = { commercialCodes: [product], dispensingPointIds: [pointId], limit: 1 };

    const fingerprint = async () => {
      const result = await database.pool.query<{ snapshot: unknown }>(
        `select jsonb_build_object(
           'allocations', (select jsonb_agg(to_jsonb(a) order by a.id)
             from inventory_authorization_allocations a where a.authorization_item_id = $1),
           'batches', (select jsonb_agg(to_jsonb(b) order by b.id)
             from inventory_allocation_batches b where b.correlation_id = $2),
           'auditCount', (select count(*) from audit_events where correlation_id = $2),
           'receipts', (select jsonb_agg(to_jsonb(r) order by r.id)
             from purchase_order_receipts r where r.purchase_order_id = any($3::uuid[])),
           'orderLines', (select jsonb_agg(to_jsonb(l) order by l.id)
             from purchase_order_lines l where l.purchase_order_id = any($3::uuid[]))
         ) as snapshot`,
        [authorizationItemId, correlationId, purchaseOrderIds],
      );
      return result.rows[0]!.snapshot;
    };
    const beforePreview = await fingerprint();
    const preview = await reconciliation.runPage(actor, { ...options, dryRun: true });
    expect(preview).toMatchObject({
      dryRun: true, failed: 0, assignedQuantity: 0, plannedQuantity: 6, hasMore: false, nextCursor: null,
    });
    expect(preview.items[0]).toMatchObject({
      commercialCode: product, status: 'PREVIEWED',
      result: { requests: [
        { authorizationKey, purchaseOrderCode: orderCodes[0], quantity: 2 },
        { authorizationKey, purchaseOrderCode: orderCodes[1], quantity: 4 },
      ] },
    });
    expect(await fingerprint()).toEqual(beforePreview);

    const runs = await Promise.all([
      reconciliation.runPage(actor, { ...options, dryRun: false }),
      reconciliation.runPage(actor, { ...options, dryRun: false }),
    ]);
    expect(runs.reduce((sum, result) => sum + result.failed, 0)).toBe(0);
    expect(runs.reduce((sum, result) => sum + result.assignedQuantity, 0)).toBe(6);
    const allocations = await database.pool.query<{ purchase_order_code: string; quantity: number }>(
      `select po.purchase_order_code,
              sum(a.allocated_quantity - a.consumed_quantity - a.released_quantity)::int as quantity
       from inventory_authorization_allocations a
       join purchase_orders po on po.id = a.purchase_order_id
       where a.authorization_item_id = $1 and a.status in ('ALLOCATED', 'PARTIALLY_CONSUMED')
       group by po.purchase_order_code order by po.purchase_order_code`,
      [authorizationItemId],
    );
    expect(allocations.rows).toEqual([
      { purchase_order_code: orderCodes[0], quantity: 2 },
      { purchase_order_code: orderCodes[1], quantity: 4 },
    ]);
    const replay = await reconciliation.runPage(actor, { ...options, dryRun: false });
    expect(replay).toMatchObject({ failed: 0, assignedQuantity: 0 });
    const audit = await database.pool.query<{ count: number }>(
      `select count(*)::int as count from audit_events
       where correlation_id = $1 and action = 'INVENTORY_AVAILABILITY_ASSIGNED'
         and after ->> 'source' = 'AUTO'
         and after ->> 'trigger' = 'AVAILABILITY_RECONCILIATION'`,
      [correlationId],
    );
    expect(audit.rows[0]!.count).toBe(1);
    const afterExecute = await fingerprint() as Record<string, unknown>;
    const before = beforePreview as Record<string, unknown>;
    expect(afterExecute.receipts).toEqual(before.receipts);
    expect(afterExecute.orderLines).toEqual(before.orderLines);
  }, 30_000);

});
