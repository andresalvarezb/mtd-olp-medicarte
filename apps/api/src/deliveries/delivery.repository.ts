import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type { CreateDeliveryRequest, UpdateDeliveryRequest } from '@authorization/contracts';
import type { Scope } from '../common/request-scope';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
type Outcome<T> = T | { outcome: 'not_found' } | { outcome: 'version_conflict'; currentVersion: number };
type DeliveryRow = {
  id: string; purchase_order_id: string; purchase_order_code: string | null; supplier_reference: string | null;
  status: 'DRAFT' | 'DISPATCHED' | 'CANCELLED'; dispatched_at: string | null; version: number; created_at: string; updated_at: string;
  line_id: string; purchase_order_line_id: string; commercial_code: string; dispensing_point_id: string;
  dispensing_point_code: string; dispensing_point_name: string; quantity: number; lot_number: string;
  expiration_date: string; product_description: string | null; presentation: string | null;
  accepted_quantity: number; dispatched_quantity: number;
};

@Injectable()
export class DeliveryRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(body: CreateDeliveryRequest, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      await this.lockOrderLines(tx, body.purchaseOrderId, body.lines.map((line) => line.purchaseOrderLineId), scope, false);
      const order = await tx.execute<{ status: string }>(sql`select status from purchase_orders where id = ${body.purchaseOrderId} for update`);
      if (!order.rows[0] || !['ACCEPTED', 'PARTIALLY_ACCEPTED', 'IN_FULFILLMENT', 'PARTIALLY_DISPATCHED'].includes(order.rows[0].status)) throw new Error('DELIVERY_ORDER_NOT_DELIVERABLE');
      const inserted = await tx.execute<{ id: string }>(sql`insert into deliveries (purchase_order_id, supplier_reference, created_by, updated_by) values (${body.purchaseOrderId}, ${body.supplierReference ?? null}, ${scope.userId}, ${scope.userId}) returning id`);
      const id = inserted.rows[0]!.id;
      await this.insertLines(tx, id, body.lines);
      await tx.execute(sql`update purchase_orders set status = case when status in ('ACCEPTED', 'PARTIALLY_ACCEPTED') then 'IN_FULFILLMENT' else status end, updated_at = now(), updated_by = ${scope.userId} where id = ${body.purchaseOrderId}`);
      await this.audit(tx, scope, 'DELIVERY_CREATED', id, body);
      return this.findByIdOn(tx, id, scope);
    });
  }

  async update(id: string, body: UpdateDeliveryRequest, scope: Scope): Promise<Outcome<Awaited<ReturnType<DeliveryRepository['findById']>>>> {
    return this.database.db.transaction(async (tx) => {
      const delivery = await tx.execute<{ purchase_order_id: string; version: number; status: string }>(sql`select purchase_order_id, version, status from deliveries where id = ${id} for update`);
      const row = delivery.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== body.expectedVersion) return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('DELIVERY_FROZEN');
      await this.lockOrderLines(tx, row.purchase_order_id, body.lines.map((line) => line.purchaseOrderLineId), scope, false);
      await tx.execute(sql`delete from delivery_lines where delivery_id = ${id}`);
      await this.insertLines(tx, id, body.lines);
      await tx.execute(sql`update deliveries set supplier_reference = coalesce(${body.supplierReference ?? null}, supplier_reference), version = version + 1, updated_at = now(), updated_by = ${scope.userId} where id = ${id}`);
      await this.audit(tx, scope, 'DELIVERY_UPDATED', id, body);
      return this.findByIdOn(tx, id, scope);
    });
  }

  async dispatch(id: string, expectedVersion: number, scope: Scope): Promise<Outcome<Awaited<ReturnType<DeliveryRepository['findById']>>>> {
    return this.database.db.transaction(async (tx) => {
      const delivery = await tx.execute<{ purchase_order_id: string; version: number; status: string }>(sql`select purchase_order_id, version, status from deliveries where id = ${id} for update`);
      const row = delivery.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== expectedVersion) return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('DELIVERY_INVALID_TRANSITION');
      const lines = await tx.execute<{ purchase_order_line_id: string; quantity: number; commercial_code: string; dispensing_point_id: string; lot_number: string; expiration_date: string }>(sql`select purchase_order_line_id, quantity, commercial_code, dispensing_point_id, lot_number, expiration_date from delivery_lines where delivery_id = ${id} order by id`);
      if (!lines.rows.length || lines.rows.some((line) => !line.lot_number || !line.expiration_date)) throw new Error('DELIVERY_LOT_EXPIRATION_REQUIRED');
      const lineIds = lines.rows.map((line) => line.purchase_order_line_id);
      const orderLines = await this.lockOrderLines(tx, row.purchase_order_id, lineIds, scope, true);
      const requestedByLine = new Map<string, number>();
      for (const line of lines.rows) {
        const orderLine = orderLines.get(line.purchase_order_line_id)!;
        requestedByLine.set(line.purchase_order_line_id, (requestedByLine.get(line.purchase_order_line_id) ?? 0) + line.quantity);
        const requestedInDelivery = requestedByLine.get(line.purchase_order_line_id)!;
        const dispatched = await tx.execute<{ quantity: number }>(sql`select coalesce(sum(dl.quantity), 0)::int quantity from delivery_lines dl join deliveries d on d.id = dl.delivery_id where dl.purchase_order_line_id = ${line.purchase_order_line_id} and d.status = 'DISPATCHED'`);
        if (requestedInDelivery > orderLine.acceptedQuantity - (dispatched.rows[0]?.quantity ?? 0)) throw new Error('DELIVERY_OVER_DISPATCHED');
        if (line.commercial_code !== orderLine.commercialCode || line.dispensing_point_id !== orderLine.dispensingPointId) throw new Error('DELIVERY_SNAPSHOT_MISMATCH');
      }
      await tx.execute(sql`update deliveries set status = 'DISPATCHED', dispatched_at = now(), version = version + 1, updated_at = now(), updated_by = ${scope.userId} where id = ${id}`);
      await this.deriveOrderStatus(tx, row.purchase_order_id, scope.userId);
      await this.audit(tx, scope, 'DELIVERY_DISPATCHED', id, null);
      return this.findByIdOn(tx, id, scope);
    });
  }

  async cancel(id: string, expectedVersion: number, scope: Scope) {
    return this.database.db.transaction(async (tx) => {
      const result = await tx.execute<{ version: number; status: string }>(sql`select version, status from deliveries where id = ${id} for update`);
      const row = result.rows[0];
      if (!row) return { outcome: 'not_found' as const };
      if (row.version !== expectedVersion) return { outcome: 'version_conflict' as const, currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('DELIVERY_ONLY_DRAFT_CANCEL');
      await tx.execute(sql`update deliveries set status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = ${scope.userId} where id = ${id}`);
      await this.audit(tx, scope, 'DELIVERY_CANCELLED', id, null);
      return this.findByIdOn(tx, id, scope);
    });
  }

  async list(scope: Scope) {
    const rows = await this.database.db.execute<{ id: string }>(sql`select distinct d.id, d.created_at from deliveries d join delivery_lines dl on dl.delivery_id = d.id join dispensing_points dp on dp.id = dl.dispensing_point_id where ${this.scopeFilter(scope)} order by d.created_at desc`);
    return Promise.all(rows.rows.map((row) => this.findById(row.id, scope)));
  }

  findById(id: string, scope: Scope) { return this.findByIdOn(this.database.db, id, scope); }

  private async findByIdOn(conn: Tx | Database['db'], id: string, scope: Scope) {
    const rows = await conn.execute<DeliveryRow>(sql`select d.id, d.purchase_order_id, po.purchase_order_code, d.supplier_reference, d.status, d.dispatched_at, d.version, d.created_at, d.updated_at, dl.id as line_id, dl.purchase_order_line_id, dl.commercial_code, dl.dispensing_point_id, dp.code as dispensing_point_code, dp.name as dispensing_point_name, dl.quantity, dl.lot_number, dl.expiration_date, pol.product_description, pol.presentation, pol.accepted_quantity, coalesce((select sum(dl2.quantity) from delivery_lines dl2 join deliveries d2 on d2.id = dl2.delivery_id where dl2.purchase_order_line_id = dl.purchase_order_line_id and d2.status = 'DISPATCHED'), 0)::int as dispatched_quantity from deliveries d join purchase_orders po on po.id = d.purchase_order_id join delivery_lines dl on dl.delivery_id = d.id join purchase_order_lines pol on pol.id = dl.purchase_order_line_id join dispensing_points dp on dp.id = dl.dispensing_point_id where d.id = ${id} and ${this.scopeFilter(scope)} order by dl.id`);
    const first = rows.rows[0];
    if (!first) return null;
    return { id: first.id, purchaseOrderId: first.purchase_order_id, purchaseOrderCode: first.purchase_order_code, supplierReference: first.supplier_reference, status: first.status, dispatchedAt: first.dispatched_at, version: first.version, createdAt: first.created_at, updatedAt: first.updated_at, lines: rows.rows.map((line) => ({ id: line.line_id, purchaseOrderLineId: line.purchase_order_line_id, commercialCode: line.commercial_code, productDescription: line.product_description, presentation: line.presentation, dispensingPointId: line.dispensing_point_id, dispensingPointCode: line.dispensing_point_code, dispensingPointName: line.dispensing_point_name, quantity: line.quantity, lotNumber: line.lot_number, expirationDate: line.expiration_date, acceptedQuantity: line.accepted_quantity, dispatchedQuantity: line.dispatched_quantity, remainingQuantity: Math.max(line.accepted_quantity - line.dispatched_quantity, 0) })) };
  }

  private async lockOrderLines(tx: Tx, orderId: string, lineIds: readonly string[], scope: Scope, dispatch: boolean) {
    const rows = await tx.execute<{ id: string; accepted_quantity: number | null; commercial_code: string; dispensing_point_id: string }>(sql`select pol.id, pol.accepted_quantity, pol.commercial_code, pol.dispensing_point_id from purchase_order_lines pol join purchase_orders po on po.id = pol.purchase_order_id join dispensing_points dp on dp.id = pol.dispensing_point_id where pol.purchase_order_id = ${orderId} and pol.id in (${sql.join(lineIds.map((id) => sql`${id}`), sql`, `)}) and ${this.scopeFilter(scope)} order by pol.id for update of pol`);
    if (rows.rows.length !== new Set(lineIds).size) throw new Error('DELIVERY_LINE_OUT_OF_SCOPE');
    if (rows.rows.some((line) => line.accepted_quantity === null || line.accepted_quantity <= 0)) throw new Error('DELIVERY_LINE_NOT_ACCEPTED');
    if (dispatch && rows.rows.length === 0) throw new Error('DELIVERY_LINE_NOT_FOUND');
    return new Map(rows.rows.map((line) => [line.id, { acceptedQuantity: line.accepted_quantity!, commercialCode: line.commercial_code, dispensingPointId: line.dispensing_point_id }]));
  }

  private async insertLines(tx: Tx, deliveryId: string, lines: CreateDeliveryRequest['lines']) {
    for (const line of lines) await tx.execute(sql`insert into delivery_lines (delivery_id, purchase_order_line_id, commercial_code, dispensing_point_id, quantity, lot_number, expiration_date) select ${deliveryId}, pol.id, pol.commercial_code, pol.dispensing_point_id, ${line.quantity}, ${line.lotNumber}, ${line.expirationDate} from purchase_order_lines pol where pol.id = ${line.purchaseOrderLineId}`);
  }

  private async deriveOrderStatus(tx: Tx, orderId: string, userId: string) {
    const totals = await tx.execute<{ accepted: number; dispatched: number }>(sql`select coalesce(sum(pol.accepted_quantity), 0)::int accepted, coalesce((select sum(dl.quantity) from delivery_lines dl join deliveries d on d.id = dl.delivery_id where d.purchase_order_id = ${orderId} and d.status = 'DISPATCHED'), 0)::int dispatched from purchase_order_lines pol where pol.purchase_order_id = ${orderId}`);
    const total = totals.rows[0]!;
    const status = total.dispatched >= total.accepted ? 'FULLY_DISPATCHED' : 'PARTIALLY_DISPATCHED';
    await tx.execute(sql`update purchase_orders set status = ${status}, updated_at = now(), updated_by = ${userId} where id = ${orderId}`);
  }

  private scopeFilter(scope: Scope) { return scope.organizationCode === 'OLP' || scope.organizationCode === 'MEDICARTE' ? sql`true` : sql`dp.organization_id = ${scope.organizationId}`; }
  private async audit(tx: Tx, scope: Scope, action: string, id: string, after: unknown) { await tx.execute(sql`insert into audit_events (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result) values ('USER', ${scope.userId}, ${scope.organizationId}, ${action}, 'delivery', ${id}, ${after ? JSON.stringify(after) : null}::jsonb, ${scope.correlationId}, ${scope.correlationId}, 'SUCCESS')`); }
}
