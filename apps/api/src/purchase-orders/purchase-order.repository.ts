import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import type { CreatePurchaseOrderRequest, PurchaseOrderListQuery, UpdatePurchaseOrderRequest } from '@authorization/contracts';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type PurchaseOrderActor = Readonly<{ userId: string; organizationId: string; correlationId: string }>;

type LineInput = CreatePurchaseOrderRequest['lines'][number];
type Outcome<T> = T | { outcome: 'not_found' } | { outcome: 'version_conflict'; currentVersion: number };
type PurchaseOrderJoinedRow = {
  id: string; purchase_order_code: string | null; planning_period_id: string; order_type: 'STANDARD' | 'COMPLEMENTARY'; status: string; version: number; issued_at: string | null; issued_by: string | null; created_at: string; updated_at: string;
  line_id: string | null; commercial_code: string | null; product_description: string | null; presentation: string | null; dispensing_point_id: string | null; dispensing_point_code: string | null; dispensing_point_name: string | null; requested_quantity: number | null; accepted_quantity: number | null; requested_delivery_date: string | null; compensar_unit_rate_snapshot: string | null; supplier_unit_cost: string | null; projected_demand_line_id: string | null; projected_demand_revision: number | null; demand_bucket: 'REGULAR' | 'LATE' | null; allocated_quantity: number | null; current_demand_revision: number | null;
};

@Injectable()
export class PurchaseOrderRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(input: { body: CreatePurchaseOrderRequest; actor: PurchaseOrderActor }) {
    return this.database.db.transaction(async (tx) => {
      await this.lockDemandLines(tx, input.body.lines);
      const order = await tx.execute<{ id: string }>(sql`
        insert into purchase_orders (purchase_order_code, planning_period_id, order_type, created_by, updated_by)
        values (${input.body.purchaseOrderCode ?? null}, ${input.body.planningPeriodId}, ${input.body.orderType}, ${input.actor.userId}, ${input.actor.userId}) returning id`);
      const id = order.rows[0]!.id;
      await this.replaceLines(tx, id, input.body.lines, input.body.orderType);
      await this.audit(tx, input.actor, 'PURCHASE_ORDER_CREATED', id, null);
      return this.findByIdOn(tx, id);
    });
  }

  async update(input: { id: string; body: UpdatePurchaseOrderRequest; actor: PurchaseOrderActor }): Promise<Outcome<Awaited<ReturnType<PurchaseOrderRepository['findById']>>>> {
    return this.database.db.transaction(async (tx) => {
      const current = await tx.execute<{ version: number; status: string; order_type: 'STANDARD' | 'COMPLEMENTARY' }>(sql`select version, status, order_type from purchase_orders where id = ${input.id} for update`);
      const row = current.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== input.body.expectedVersion) return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('PURCHASE_ORDER_FROZEN');
      if (input.body.lines) {
        await this.lockDemandLines(tx, input.body.lines);
        await tx.execute(sql`delete from purchase_order_demand_allocations where purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id = ${input.id})`);
        await tx.execute(sql`delete from purchase_order_lines where purchase_order_id = ${input.id}`);
        await this.replaceLines(tx, input.id, input.body.lines, row.order_type);
      }
      await tx.execute(sql`update purchase_orders set purchase_order_code = coalesce(${input.body.purchaseOrderCode ?? null}, purchase_order_code), version = version + 1, updated_at = now(), updated_by = ${input.actor.userId} where id = ${input.id}`);
      await this.audit(tx, input.actor, 'PURCHASE_ORDER_UPDATED', input.id, input.body);
      return this.findByIdOn(tx, input.id);
    });
  }

  async issue(id: string, expectedVersion: number, actor: PurchaseOrderActor): Promise<Outcome<Awaited<ReturnType<PurchaseOrderRepository['findById']>>>> {
    return this.transition(id, expectedVersion, actor, async (tx, row) => {
      if (row.status !== 'DRAFT') throw new Error('PURCHASE_ORDER_INVALID_TRANSITION');
      const code = await tx.execute<{ purchase_order_code: string | null }>(sql`select purchase_order_code from purchase_orders where id = ${id}`);
      if (!code.rows[0]?.purchase_order_code) throw new Error('PURCHASE_ORDER_CODE_REQUIRED');
      await tx.execute(sql`update purchase_orders set status = 'ISSUED', issued_at = now(), issued_by = ${actor.userId}, version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`);
      await this.audit(tx, actor, 'PURCHASE_ORDER_ISSUED', id, null);
    });
  }

  async cancel(id: string, expectedVersion: number, actor: PurchaseOrderActor) {
    return this.transition(id, expectedVersion, actor, async (tx, row) => {
      if (!['DRAFT', 'ISSUED'].includes(row.status)) throw new Error('PURCHASE_ORDER_INVALID_TRANSITION');
      await tx.execute(sql`update purchase_orders set status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`);
      await this.audit(tx, actor, 'PURCHASE_ORDER_CANCELLED', id, null);
    });
  }

  private async transition(id: string, expectedVersion: number, actor: PurchaseOrderActor, action: (tx: Tx, row: { version: number; status: string }) => Promise<void>) {
    return this.database.db.transaction(async (tx) => {
      const result = await tx.execute<{ version: number; status: string }>(sql`select version, status from purchase_orders where id = ${id} for update`);
      const row = result.rows[0];
      if (!row) return { outcome: 'not_found' as const };
      if (row.version !== expectedVersion) return { outcome: 'version_conflict' as const, currentVersion: row.version };
      await action(tx, row);
      return this.findByIdOn(tx, id);
    });
  }

  async reviewLine(id: string, lineId: string, input: { acceptedQuantity: number; supplierUnitCost?: number; expectedVersion: number }, actor: PurchaseOrderActor) {
    return this.database.db.transaction(async (tx) => {
      const order = await tx.execute<{ version: number; status: string }>(sql`select version, status from purchase_orders where id = ${id} for update`);
      const row = order.rows[0];
      if (!row || !['ISSUED', 'UNDER_OLP_REVIEW'].includes(row.status)) throw new Error('PURCHASE_ORDER_NOT_REVIEWABLE');
      if (row.version !== input.expectedVersion) return { outcome: 'version_conflict' as const, currentVersion: row.version };
      const update = await tx.execute(sql`update purchase_order_lines set accepted_quantity = ${input.acceptedQuantity}, supplier_unit_cost = ${input.supplierUnitCost?.toFixed(2) ?? null}, updated_at = now() where id = ${lineId} and purchase_order_id = ${id} returning id`);
      if (!update.rows[0]) throw new Error('PURCHASE_ORDER_LINE_NOT_FOUND');
      await tx.execute(sql`update purchase_orders set status = 'UNDER_OLP_REVIEW', version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`);
      await this.audit(tx, actor, 'PURCHASE_ORDER_LINE_REVIEWED', lineId, input);
      return this.findByIdOn(tx, id);
    });
  }

  async completeReview(id: string, expectedVersion: number, actor: PurchaseOrderActor) {
    return this.database.db.transaction(async (tx) => {
      const order = await tx.execute<{ version: number; status: string }>(sql`select version, status from purchase_orders where id = ${id} for update`);
      const row = order.rows[0];
      if (!row || row.status !== 'UNDER_OLP_REVIEW') throw new Error('PURCHASE_ORDER_NOT_REVIEWABLE');
      if (row.version !== expectedVersion) return { outcome: 'version_conflict' as const, currentVersion: row.version };
       const counts = await tx.execute<{ total: number; accepted: number; positive: number; full: number }>(sql`select count(*)::int total, count(*) filter (where accepted_quantity is not null)::int accepted, count(*) filter (where accepted_quantity > 0)::int positive, count(*) filter (where accepted_quantity = requested_quantity)::int full from purchase_order_lines where purchase_order_id = ${id}`);
      const c = counts.rows[0]!;
      if (c.total !== c.accepted) throw new Error('PURCHASE_ORDER_REVIEW_INCOMPLETE');
       const status = c.positive === 0 ? 'REJECTED' : c.full === c.total ? 'ACCEPTED' : 'PARTIALLY_ACCEPTED';
      await tx.execute(sql`update purchase_orders set status = ${status}, version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`);
      await this.audit(tx, actor, 'PURCHASE_ORDER_SUPPLIER_REVIEW_COMPLETED', id, { status });
      return this.findByIdOn(tx, id);
    });
  }

  async list(query: PurchaseOrderListQuery, supplier = false) {
    const filters = [sql`po.status <> 'CANCELLED'`];
    if (supplier) filters.push(sql`po.status <> 'DRAFT'`);
    if (query.planningPeriodId) filters.push(sql`po.planning_period_id = ${query.planningPeriodId}`);
    if (query.status) filters.push(sql`po.status = ${query.status}`);
    const rows = await this.database.db.execute<{ id: string }>(sql`select po.id from purchase_orders po where ${sql.join(filters, sql` and `)} order by po.created_at desc limit ${query.limit}`);
    return Promise.all(rows.rows.map((row) => this.findById(row.id, supplier)));
  }

  findById(id: string, supplier = false) { return this.findByIdOn(this.database.db, id, supplier); }

  async available(planningPeriodId: string) {
    const rows = await this.database.db.execute(sql`with ordered as (
       select pol.dispensing_point_id, pol.commercial_code, po.planning_period_id, a.demand_bucket,
              coalesce(sum(case
                when po.status in ('DRAFT', 'ISSUED', 'UNDER_OLP_REVIEW') then a.allocated_quantity
                when po.status in ('REJECTED', 'CANCELLED') then 0
                else coalesce(pol.accepted_quantity, 0)
              end), 0)::int effective_coverage
       from purchase_order_demand_allocations a
       join purchase_order_lines pol on pol.id = a.purchase_order_line_id
       join purchase_orders po on po.id = pol.purchase_order_id
       where po.planning_period_id = ${planningPeriodId}
       group by pol.dispensing_point_id, pol.commercial_code, po.planning_period_id, a.demand_bucket
    )
    select pdl.id, pdl.commercial_code as "commercialCode", pdl.dispensing_point_id as "dispensingPointId", pdl.revision,
      pdl.regular_quantity as "regularQuantity", pdl.late_quantity as "lateQuantity",
      greatest(pdl.regular_quantity - coalesce(r.effective_coverage, 0), 0)::int as "regularAvailable",
      greatest(pdl.late_quantity - coalesce(l.effective_coverage, 0), 0)::int as "lateAvailable",
      greatest(coalesce(r.effective_coverage, 0) - pdl.regular_quantity, 0)::int as "regularOverOrdered",
      greatest(coalesce(l.effective_coverage, 0) - pdl.late_quantity, 0)::int as "lateOverOrdered"
    from projected_demand_lines pdl
    left join ordered r on r.planning_period_id = pdl.planning_period_id and r.dispensing_point_id = pdl.dispensing_point_id and r.commercial_code = pdl.commercial_code and r.demand_bucket = 'REGULAR'
    left join ordered l on l.planning_period_id = pdl.planning_period_id and l.dispensing_point_id = pdl.dispensing_point_id and l.commercial_code = pdl.commercial_code and l.demand_bucket = 'LATE'
    where pdl.planning_period_id = ${planningPeriodId} order by pdl.commercial_code`);
    return rows.rows;
  }

  private async lockDemandLines(tx: Tx, lines: readonly LineInput[]) {
    const ids = [...new Set(lines.map((line) => line.projectedDemandLineId))].sort();
    const locked = await tx.execute<{ id: string; planning_period_id: string; commercial_code: string; dispensing_point_id: string; revision: number; regular_quantity: number; late_quantity: number; tarifa_unidad: string | null; descripcion_generica: string | null; consecutivo_invima_presentacion: string | null }>(sql`select pdl.id, pdl.planning_period_id, pdl.commercial_code, pdl.dispensing_point_id, pdl.revision, pdl.regular_quantity, pdl.late_quantity, tap.tarifa_unidad, tap.descripcion_generica, tap.consecutivo_invima_presentacion from projected_demand_lines pdl left join tariff_annex_products tap on tap.codigo_producto = pdl.commercial_code and tap.active = true where pdl.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) order by pdl.id for update of pdl`);
    if (locked.rows.length !== ids.length) throw new Error('PROJECTED_DEMAND_LINE_NOT_FOUND');
    for (const line of lines) {
      const demand = locked.rows.find((item) => item.id === line.projectedDemandLineId)!;
      if (demand.revision !== line.expectedDemandRevision) throw new Error('PROJECTED_DEMAND_REVISION_CONFLICT');
      if (!demand.tarifa_unidad) throw new Error('TARIFF_RATE_NOT_FOUND');
      const available = line.demandBucket === 'REGULAR' ? demand.regular_quantity : demand.late_quantity;
       const coverage = await tx.execute<{ quantity: number }>(sql`select coalesce(sum(case
         when po.status in ('DRAFT', 'ISSUED', 'UNDER_OLP_REVIEW') then a.allocated_quantity
         when po.status in ('REJECTED', 'CANCELLED') then 0
         else coalesce(pol.accepted_quantity, 0)
       end), 0)::int quantity from purchase_order_demand_allocations a join purchase_order_lines pol on pol.id = a.purchase_order_line_id join purchase_orders po on po.id = pol.purchase_order_id where po.planning_period_id = ${demand.planning_period_id} and pol.dispensing_point_id = ${demand.dispensing_point_id} and pol.commercial_code = ${demand.commercial_code} and a.demand_bucket = ${line.demandBucket}`);
       if (line.requestedQuantity > available - (coverage.rows[0]?.quantity ?? 0)) throw new Error('PURCHASE_ORDER_DEMAND_OVERALLOCATED');
    }
  }

  private async replaceLines(tx: Tx, orderId: string, lines: readonly LineInput[], orderType: string) {
    for (const line of lines) {
      const demand = await tx.execute<{ commercial_code: string; dispensing_point_id: string; tarifa_unidad: string; descripcion_generica: string | null; consecutivo_invima_presentacion: string | null }>(sql`select pdl.commercial_code, pdl.dispensing_point_id, tap.tarifa_unidad, tap.descripcion_generica, tap.consecutivo_invima_presentacion from projected_demand_lines pdl join tariff_annex_products tap on tap.codigo_producto = pdl.commercial_code and tap.active = true where pdl.id = ${line.projectedDemandLineId}`);
      const d = demand.rows[0]!;
      const inserted = await tx.execute<{ id: string }>(sql`insert into purchase_order_lines (purchase_order_id, commercial_code, product_description, presentation, dispensing_point_id, requested_quantity, requested_delivery_date, compensar_unit_rate_snapshot, projected_demand_line_id, projected_demand_revision, demand_bucket) values (${orderId}, ${d.commercial_code}, ${d.descripcion_generica}, ${d.consecutivo_invima_presentacion}, ${d.dispensing_point_id}, ${line.requestedQuantity}, ${line.requestedDeliveryDate}, ${d.tarifa_unidad}, ${line.projectedDemandLineId}, ${line.expectedDemandRevision}, ${line.demandBucket}) returning id`);
      await tx.execute(sql`insert into purchase_order_demand_allocations (purchase_order_line_id, projected_demand_line_id, projected_demand_revision, demand_bucket, allocated_quantity) values (${inserted.rows[0]!.id}, ${line.projectedDemandLineId}, ${line.expectedDemandRevision}, ${line.demandBucket}, ${line.requestedQuantity})`);
       if (orderType === 'STANDARD' && line.demandBucket !== 'REGULAR') throw new Error('PURCHASE_ORDER_BUCKET_MISMATCH');
    }
  }

  private async findByIdOn(conn: Tx | Database['db'], id: string, supplier = false) {
    const rows = await conn.execute<PurchaseOrderJoinedRow>(sql`select po.id, po.purchase_order_code, po.planning_period_id, po.order_type, po.status, po.version, po.issued_at, po.issued_by, po.created_at, po.updated_at, pol.id as line_id, pol.commercial_code, pol.product_description, pol.presentation, pol.dispensing_point_id, dp.code as dispensing_point_code, dp.name as dispensing_point_name, pol.requested_quantity, pol.accepted_quantity, pol.requested_delivery_date, pol.compensar_unit_rate_snapshot, pol.supplier_unit_cost, pol.projected_demand_line_id, pol.projected_demand_revision, pol.demand_bucket, a.allocated_quantity, pdl.revision as current_demand_revision from purchase_orders po left join purchase_order_lines pol on pol.purchase_order_id = po.id left join purchase_order_demand_allocations a on a.purchase_order_line_id = pol.id left join dispensing_points dp on dp.id = pol.dispensing_point_id left join projected_demand_lines pdl on pdl.id = pol.projected_demand_line_id where po.id = ${id} order by pol.id`);
    const first = rows.rows[0];
    if (!first) return null;
     return { id: first.id, purchaseOrderCode: first.purchase_order_code, planningPeriodId: first.planning_period_id, orderType: first.order_type, status: first.status, version: first.version, issuedAt: first.issued_at, issuedBy: first.issued_by, createdAt: first.created_at, updatedAt: first.updated_at, lines: rows.rows.filter((r) => r.line_id).map((r) => ({ id: r.line_id, commercialCode: r.commercial_code, productDescription: r.product_description, presentation: r.presentation, dispensingPointId: r.dispensing_point_id, dispensingPointCode: r.dispensing_point_code, dispensingPointName: r.dispensing_point_name, requestedQuantity: r.requested_quantity, acceptedQuantity: r.accepted_quantity, shortage: (r.requested_quantity ?? 0) - (r.accepted_quantity ?? 0), requestedDeliveryDate: r.requested_delivery_date, compensarUnitRateSnapshot: r.compensar_unit_rate_snapshot, supplierUnitCost: supplier ? r.supplier_unit_cost : r.supplier_unit_cost, projectedDemandLineId: r.projected_demand_line_id, projectedDemandRevision: r.projected_demand_revision, demandBucket: r.demand_bucket, allocatedQuantity: r.allocated_quantity, sourceDemandChanged: r.current_demand_revision !== r.projected_demand_revision })) };
  }

  private async audit(tx: Tx, actor: PurchaseOrderActor, action: string, resourceId: string, after: unknown) {
    await tx.execute(sql`insert into audit_events (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result) values ('USER', ${actor.userId}, ${actor.organizationId}, ${action}, 'purchase_order', ${resourceId}, ${after ? JSON.stringify(after) : null}::jsonb, ${actor.correlationId}, ${actor.correlationId}, 'SUCCESS')`);
  }
}
