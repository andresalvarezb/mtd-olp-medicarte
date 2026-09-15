import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import { deriveReceiptConformity, validateReceiptQuantities } from '@authorization/domain';
import type { Scope } from '../common/request-scope';
import { applyPointScope, lockActivePointGrants } from '../common/point-scope.sql';
import { DATABASE } from '../tokens';
import type { ReceiptLineRequest, UpdateReceiptRequest } from '@authorization/contracts';
import { InventoryRepository } from '../inventory/inventory.repository';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type ReceiptOutcome =
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict'; currentVersion: number };
type ReceiptViewRow = {
  id: string;
  delivery_id: string;
  status: string;
  conformity: string | null;
  received_at: string;
  confirmed_at: string | null;
  version: number;
  created_by: string;
  updated_by: string;
  line_id: string;
  delivery_line_id: string;
  dispatched_quantity: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  shortage_quantity: number;
  expected_lot_number: string;
  expected_expiration_date: string;
  received_lot_number: string | null;
  received_expiration_date: string | null;
  line_conformity: string | null;
  nonconformity_reason: string | null;
  observation: string | null;
};

@Injectable()
export class ReceiptRepository {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly inventory: InventoryRepository,
  ) {}

  async create(deliveryId: string, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const delivery = await tx.execute<{ purchase_order_id: string; status: string }>(
        sql`select d.purchase_order_id,d.status from deliveries d where d.id=${deliveryId} for update`,
      );
      if (!delivery.rows[0]) throw new Error('RECEIPT_DELIVERY_NOT_FOUND');
      await this.lockDeliveryPoints(tx, deliveryId, scope);
      if (delivery.rows[0].status !== 'DISPATCHED')
        throw new Error('RECEIPT_DELIVERY_NOT_DISPATCHED');
      const existing = await tx.execute<{ id: string }>(
        sql`select id from receipts where delivery_id=${deliveryId} and status='CONFIRMED'`,
      );
      if (existing.rows[0]) throw new Error('RECEIPT_ALREADY_CONFIRMED');
      const found = await tx.execute<{ id: string }>(
        sql`select id from receipts where delivery_id=${deliveryId} and status='DRAFT' limit 1`,
      );
      const id =
        found.rows[0]?.id ??
        (
          await tx.execute<{ id: string }>(
            sql`insert into receipts (delivery_id,created_by,updated_by) values (${deliveryId},${scope.userId},${scope.userId}) returning id`,
          )
        ).rows[0]!.id;
      if (!found.rows[0]) {
        await tx.execute(
          sql`insert into receipt_lines (receipt_id,delivery_line_id,dispatched_quantity,received_quantity,accepted_quantity,rejected_quantity,shortage_quantity,expected_lot_number,expected_expiration_date) select ${id},dl.id,dl.quantity,0,0,0,dl.quantity,dl.lot_number,dl.expiration_date from delivery_lines dl where dl.delivery_id=${deliveryId}`,
        );
        await this.audit(tx, scope, 'RECEIPT_CREATED', id, { deliveryId });
      }
      return this.findOn(tx, id, scope);
    });
  }

  async update(
    id: string,
    body: UpdateReceiptRequest,
    scope: Scope,
  ): Promise<ReceiptOutcome | object | null> {
    return this.database.db.transaction(async (tx) => {
      const receipt = await tx.execute<{ delivery_id: string; status: string; version: number }>(
        sql`select delivery_id,status,version from receipts where id=${id} for update`,
      );
      const row = receipt.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== body.expectedVersion)
        return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('RECEIPT_FROZEN');
      await this.lockDeliveryPoints(tx, row.delivery_id, scope);
      await this.replaceLines(tx, id, row.delivery_id, body.lines, scope);
      await tx.execute(
        sql`update receipts set received_at=coalesce(${body.receivedAt ?? null}::timestamptz,received_at),version=version+1,updated_at=now(),updated_by=${scope.userId} where id=${id}`,
      );
      await this.audit(tx, scope, 'RECEIPT_UPDATED', id, { lineCount: body.lines.length });
      return this.findOn(tx, id, scope);
    });
  }

  async confirm(
    id: string,
    expectedVersion: number,
    scope: Scope,
  ): Promise<ReceiptOutcome | object | null> {
    return this.database.db.transaction(async (tx) => {
      const receipt = await tx.execute<{
        delivery_id: string;
        status: string;
        version: number;
        received_date: string;
      }>(
        sql`select delivery_id,status,version,received_at::date received_date from receipts where id=${id} for update`,
      );
      const row = receipt.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== expectedVersion)
        return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('RECEIPT_FROZEN');
      await this.lockDeliveryPoints(tx, row.delivery_id, scope);
      const delivery = await tx.execute<{ purchase_order_id: string; status: string }>(
        sql`select purchase_order_id,status from deliveries where id=${row.delivery_id} for update`,
      );
      if (!delivery.rows[0]) throw new Error('RECEIPT_DELIVERY_NOT_FOUND');
      if (delivery.rows[0].status !== 'DISPATCHED')
        throw new Error('RECEIPT_DELIVERY_NOT_DISPATCHED');
      const lines = await tx.execute<{
        id: string;
        dispatched_quantity: number;
        received_quantity: number;
        accepted_quantity: number;
        rejected_quantity: number;
        expected_lot_number: string;
        expected_expiration_date: string;
        received_lot_number: string | null;
        received_expiration_date: string | null;
        nonconformity_reason: string | null;
      }>(
        sql`select id,dispatched_quantity,received_quantity,accepted_quantity,rejected_quantity,expected_lot_number,expected_expiration_date::text expected_expiration_date,received_lot_number,received_expiration_date::text received_expiration_date,nonconformity_reason from receipt_lines where receipt_id=${id} for update`,
      );
      if (!lines.rows.length) throw new Error('RECEIPT_LINES_REQUIRED');
      const deliveryLines = await tx.execute<{ count: number }>(
        sql`select count(*)::int count from delivery_lines where delivery_id=${row.delivery_id}`,
      );
      if (lines.rows.length !== (deliveryLines.rows[0]?.count ?? 0))
        throw new Error('RECEIPT_LINES_REQUIRED');
      const conformities = lines.rows.map((line) => {
        const error = validateReceiptQuantities({
          dispatched: line.dispatched_quantity,
          received: line.received_quantity,
          accepted: line.accepted_quantity,
          rejected: line.rejected_quantity,
        });
        if (error) throw new Error(error);
        if (
          line.accepted_quantity > 0 &&
          (!line.received_lot_number || !line.received_expiration_date)
        )
          throw new Error('RECEIPT_LOT_EXPIRATION_REQUIRED');
        if (line.accepted_quantity > 0 && line.received_expiration_date! < row.received_date)
          throw new Error('RECEIPT_EXPIRED_PRODUCT');
        const discrepancy =
          Boolean(line.nonconformity_reason) ||
          line.received_lot_number !== line.expected_lot_number ||
          line.received_expiration_date !== line.expected_expiration_date;
        const conformity = deriveReceiptConformity(
          {
            dispatched: line.dispatched_quantity,
            received: line.received_quantity,
            accepted: line.accepted_quantity,
            rejected: line.rejected_quantity,
          },
          discrepancy,
        );
        return { id: line.id, conformity };
      });
      for (const line of conformities)
        await tx.execute(
          sql`update receipt_lines set conformity=${line.conformity} where id=${line.id}`,
        );
      const overall = conformities.every((line) => line.conformity === 'CONFORMING')
        ? 'CONFORMING'
        : lines.rows.every((line) => line.accepted_quantity === 0)
          ? 'NON_CONFORMING'
          : 'PARTIALLY_CONFORMING';
      await tx.execute(
        sql`update receipts set status='CONFIRMED',conformity=${overall},confirmed_at=now(),version=version+1,updated_at=now(),updated_by=${scope.userId} where id=${id}`,
      );
      await this.inventory.recordConfirmedReceipt(tx, id, scope);
      await tx.execute(
        sql`update deliveries set status='RECEIVED',version=version+1,updated_at=now(),updated_by=${scope.userId} where id=${row.delivery_id}`,
      );
      await this.deriveOrderStatus(tx, delivery.rows[0].purchase_order_id, scope.userId);
      await this.audit(tx, scope, 'RECEIPT_CONFIRMED', id, { conformity: overall });
      return this.findOn(tx, id, scope);
    });
  }

  list(scope: Scope, pending = false) {
    const filter = pending ? sql`d.status='DISPATCHED' and r.status='DRAFT'` : sql`true`;
    return this.database.db
      .execute<{
        id: string;
      }>(
        sql`select distinct r.id from receipts r join deliveries d on d.id=r.delivery_id join delivery_lines dl on dl.delivery_id=d.id join dispensing_points dp on dp.id=dl.dispensing_point_id where ${filter} and ${this.scopeFilter(scope)} and ${this.deliveryFullyInScope(scope)} order by r.id`,
      )
      .then((result) => Promise.all(result.rows.map((r) => this.find(r.id, scope))));
  }
  find(id: string, scope: Scope) {
    return this.findOn(this.database.db, id, scope);
  }

  async existsIgnoringPoint(id: string, scope: Scope): Promise<boolean> {
    const org =
      scope.organizationCode === 'OLP' ||
      scope.organizationCode === 'MEDICARTE' ||
      scope.organizationCode === 'MTD'
        ? sql`true`
        : sql`dp.organization_id=${scope.organizationId}`;
    const result = await this.database.db.execute<{ id: string }>(
      sql`select r.id from receipts r join deliveries d on d.id=r.delivery_id join delivery_lines dl on dl.delivery_id=d.id join dispensing_points dp on dp.id=dl.dispensing_point_id where r.id=${id} and ${org} limit 1`,
    );
    return Boolean(result.rows[0]);
  }

  private async replaceLines(
    tx: Tx,
    receiptId: string,
    deliveryId: string,
    lines: ReceiptLineRequest[],
    scope: Scope,
  ) {
    await tx.execute(sql`delete from receipt_lines where receipt_id=${receiptId}`);
    for (const line of lines) {
      const inserted = await tx.execute(
        sql`insert into receipt_lines (receipt_id, delivery_line_id, dispatched_quantity, received_quantity, accepted_quantity, rejected_quantity, shortage_quantity, expected_lot_number, expected_expiration_date, received_lot_number, received_expiration_date, nonconformity_reason, observation) select ${receiptId}, dl.id, dl.quantity, ${line.receivedQuantity}, ${line.acceptedQuantity}, ${line.rejectedQuantity}, dl.quantity - ${line.receivedQuantity}, dl.lot_number, dl.expiration_date, ${line.receivedLotNumber ?? null}, ${line.receivedExpirationDate ?? null}, ${line.nonconformityReason ?? null}, ${line.observation ?? null} from delivery_lines dl join deliveries d on d.id = dl.delivery_id join dispensing_points dp on dp.id = dl.dispensing_point_id where dl.id = ${line.deliveryLineId} and d.id = ${deliveryId} and ${this.scopeFilter(scope)}`,
      );
      if (inserted.rowCount !== 1) throw new Error('RECEIPT_LINE_OUT_OF_SCOPE');
    }
  }
  private async findOn(conn: Tx | Database['db'], id: string, scope: Scope) {
    const rows = await conn.execute<ReceiptViewRow>(
      sql`select r.*,d.purchase_order_id,dlr.id line_id,dlr.delivery_line_id,dlr.dispatched_quantity,dlr.received_quantity,dlr.accepted_quantity,dlr.rejected_quantity,dlr.shortage_quantity,dlr.expected_lot_number,dlr.expected_expiration_date,dlr.received_lot_number,dlr.received_expiration_date,dlr.conformity line_conformity,dlr.nonconformity_reason,dlr.observation from receipts r join deliveries d on d.id=r.delivery_id join receipt_lines dlr on dlr.receipt_id=r.id join delivery_lines dl on dl.id=dlr.delivery_line_id join dispensing_points dp on dp.id=dl.dispensing_point_id where r.id=${id} and ${this.scopeFilter(scope)} order by dlr.id`,
    );
    if (!rows.rows[0]) return null;
    const first = rows.rows[0];
    return {
      id: first.id,
      deliveryId: first.delivery_id,
      status: first.status,
      conformity: first.conformity,
      receivedAt: first.received_at,
      confirmedAt: first.confirmed_at,
      version: first.version,
      createdBy: first.created_by,
      updatedBy: first.updated_by,
      lines: rows.rows.map((line) => ({
        id: line.line_id,
        deliveryLineId: line.delivery_line_id,
        dispatchedQuantity: line.dispatched_quantity,
        receivedQuantity: line.received_quantity,
        acceptedQuantity: line.accepted_quantity,
        rejectedQuantity: line.rejected_quantity,
        shortageQuantity: line.shortage_quantity,
        expectedLotNumber: line.expected_lot_number,
        expectedExpirationDate: line.expected_expiration_date,
        receivedLotNumber: line.received_lot_number,
        receivedExpirationDate: line.received_expiration_date,
        conformity: line.line_conformity,
        nonconformityReason: line.nonconformity_reason,
        observation: line.observation,
      })),
    };
  }
  private async deriveOrderStatus(tx: Tx, orderId: string, userId: string) {
    const totals = await tx.execute<{ total: number; processed: number }>(
      sql`select count(*)::int total, count(*) filter (where d.status='RECEIVED')::int processed from deliveries d where d.purchase_order_id=${orderId} and d.status in ('DISPATCHED','RECEIVED')`,
    );
    const t = totals.rows[0]!;
    await tx.execute(
      sql`update purchase_orders set status=${t.processed === t.total ? 'RECEIVED' : 'PARTIALLY_RECEIVED'},updated_at=now(),updated_by=${userId} where id=${orderId}`,
    );
  }
  private scopeFilter(scope: Scope) {
    const org =
      scope.organizationCode === 'OLP' ||
      scope.organizationCode === 'MEDICARTE' ||
      scope.organizationCode === 'MTD'
        ? sql`true`
        : sql`dp.organization_id=${scope.organizationId}`;
    return sql`${org} and ${applyPointScope(sql`dp.id`, scope)}`;
  }

  private deliveryFullyInScope(scope: Scope) {
    if (scope.pointAccessKind !== 'explicit') return sql`true`;
    return sql`not exists (
      select 1 from delivery_lines xdl
      where xdl.delivery_id = d.id
        and xdl.dispensing_point_id not in (
          select ups.dispensing_point_id from user_point_scopes ups
          where ups.user_id = ${scope.userId}::uuid and ups.revoked_at is null
        )
    )`;
  }

  private async lockDeliveryPoints(tx: Tx, deliveryId: string, scope: Scope): Promise<void> {
    const points = await tx.execute<{ dispensing_point_id: string }>(
      sql`select distinct dispensing_point_id from delivery_lines where delivery_id=${deliveryId}`,
    );
    await lockActivePointGrants(
      tx,
      scope,
      points.rows.map((row) => row.dispensing_point_id),
    );
  }
  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) {
    await tx.execute(
      sql`insert into audit_events (actor_type,actor_id,organization_id,action,resource_type,resource_id,after,correlation_id,request_id,result) values ('USER',${scope.userId},${scope.organizationId},${action},'receipt',${id},${JSON.stringify(after)}::jsonb,${scope.correlationId},${scope.correlationId},'SUCCESS')`,
    );
  }
}
