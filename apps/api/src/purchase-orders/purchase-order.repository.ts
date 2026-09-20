import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import { normalizeInvimaComponent } from '@authorization/domain';
import type {
  CreatePurchaseOrderRequest,
  PurchaseOrderListQuery,
  UpdatePurchaseOrderRequest,
} from '@authorization/contracts';
import { DATABASE } from '../tokens';
import type { Scope } from '../common/request-scope';

type Database = ReturnType<typeof createDatabase>;
type Tx = Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export type PurchaseOrderActor = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;

type LineInput = CreatePurchaseOrderRequest['lines'][number];
type Outcome<T> =
  | T
  | { outcome: 'not_found' }
  | { outcome: 'version_conflict'; currentVersion: number };
type PurchaseOrderJoinedRow = {
  id: string;
  purchase_order_code: string | null;
  planning_period_id: string;
  order_type: 'STANDARD' | 'COMPLEMENTARY';
  status: string;
  version: number;
  issued_at: string | null;
  issued_by: string | null;
  created_at: string;
  updated_at: string;
  line_id: string | null;
  commercial_code: string | null;
  product_description: string | null;
  presentation: string | null;
  dispensing_point_id: string | null;
  dispensing_point_code: string | null;
  dispensing_point_name: string | null;
  requested_quantity: number | null;
  accepted_quantity: number | null;
  requested_delivery_date: string | null;
  compensar_unit_rate_snapshot: string | null;
  supplier_unit_cost: string | null;
  projected_demand_line_id: string | null;
  projected_demand_revision: number | null;
  demand_bucket: 'REGULAR' | 'LATE' | null;
  allocated_quantity: number | null;
  current_demand_revision: number | null;
};

@Injectable()
export class PurchaseOrderRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async create(input: { body: CreatePurchaseOrderRequest; actor: PurchaseOrderActor }) {
    return this.database.db.transaction(async (tx) => {
      await this.lockDemandLines(tx, input.body.planningPeriodId, input.body.lines);
      const order = await tx.execute<{ id: string }>(sql`
        insert into purchase_orders (purchase_order_code, planning_period_id, order_type, created_by, updated_by)
        values (${input.body.purchaseOrderCode ?? null}, ${input.body.planningPeriodId}, ${input.body.orderType}, ${input.actor.userId}, ${input.actor.userId}) returning id`);
      const id = order.rows[0]!.id;
      await this.replaceLines(tx, id, input.body.lines, input.body.orderType);
      await this.audit(tx, input.actor, 'PURCHASE_ORDER_CREATED', id, null);
      return this.findByIdOn(tx, id);
    });
  }

  async update(input: {
    id: string;
    body: UpdatePurchaseOrderRequest;
    actor: PurchaseOrderActor;
  }): Promise<Outcome<Awaited<ReturnType<PurchaseOrderRepository['findById']>>>> {
    return this.database.db.transaction(async (tx) => {
      const current = await tx.execute<{
        version: number;
        status: string;
        order_type: 'STANDARD' | 'COMPLEMENTARY';
        planning_period_id: string;
      }>(
        sql`select version, status, order_type, planning_period_id from purchase_orders where id = ${input.id} for update`,
      );
      const row = current.rows[0];
      if (!row) return { outcome: 'not_found' };
      if (row.version !== input.body.expectedVersion)
        return { outcome: 'version_conflict', currentVersion: row.version };
      if (row.status !== 'DRAFT') throw new Error('PURCHASE_ORDER_FROZEN');
      if (input.body.lines) {
        await this.lockDemandLines(tx, row.planning_period_id, input.body.lines);
        await tx.execute(
          sql`delete from purchase_order_demand_allocations where purchase_order_line_id in (select id from purchase_order_lines where purchase_order_id = ${input.id})`,
        );
        await tx.execute(
          sql`delete from purchase_order_lines where purchase_order_id = ${input.id}`,
        );
        await this.replaceLines(tx, input.id, input.body.lines, row.order_type);
      }
      await tx.execute(
        sql`update purchase_orders set purchase_order_code = coalesce(${input.body.purchaseOrderCode ?? null}, purchase_order_code), version = version + 1, updated_at = now(), updated_by = ${input.actor.userId} where id = ${input.id}`,
      );
      await this.audit(tx, input.actor, 'PURCHASE_ORDER_UPDATED', input.id, input.body);
      return this.findByIdOn(tx, input.id);
    });
  }

  async issue(
    id: string,
    expectedVersion: number,
    actor: PurchaseOrderActor,
  ): Promise<Outcome<Awaited<ReturnType<PurchaseOrderRepository['findById']>>>> {
    return this.transition(id, expectedVersion, actor, async (tx, row) => {
      if (row.status !== 'DRAFT') throw new Error('PURCHASE_ORDER_INVALID_TRANSITION');
      const code = await tx.execute<{ purchase_order_code: string | null }>(
        sql`select purchase_order_code from purchase_orders where id = ${id}`,
      );
      if (!code.rows[0]?.purchase_order_code) throw new Error('PURCHASE_ORDER_CODE_REQUIRED');
      await tx.execute(
        sql`update purchase_orders set status = 'ISSUED', issued_at = now(), issued_by = ${actor.userId}, version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_ISSUED', id, null);
    });
  }

  async cancel(id: string, expectedVersion: number, actor: PurchaseOrderActor) {
    return this.transition(id, expectedVersion, actor, async (tx, row) => {
      if (!['DRAFT', 'ISSUED'].includes(row.status))
        throw new Error('PURCHASE_ORDER_INVALID_TRANSITION');
      await tx.execute(
        sql`update purchase_orders set status = 'CANCELLED', version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_CANCELLED', id, null);
    });
  }

  private async transition(
    id: string,
    expectedVersion: number,
    actor: PurchaseOrderActor,
    action: (tx: Tx, row: { version: number; status: string }) => Promise<void>,
  ) {
    return this.database.db.transaction(async (tx) => {
      const result = await tx.execute<{ version: number; status: string }>(
        sql`select version, status from purchase_orders where id = ${id} for update`,
      );
      const row = result.rows[0];
      if (!row) return { outcome: 'not_found' as const };
      if (row.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      await action(tx, row);
      return this.findByIdOn(tx, id);
    });
  }

  async reviewLine(
    id: string,
    lineId: string,
    input: { acceptedQuantity: number; supplierUnitCost?: number; expectedVersion: number },
    actor: PurchaseOrderActor,
  ) {
    return this.database.db.transaction(async (tx) => {
      const order = await tx.execute<{ version: number; status: string }>(
        sql`select version, status from purchase_orders where id = ${id} for update`,
      );
      const row = order.rows[0];
      if (!row || !['ISSUED', 'UNDER_OLP_REVIEW'].includes(row.status))
        throw new Error('PURCHASE_ORDER_NOT_REVIEWABLE');
      if (row.version !== input.expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      const update = await tx.execute(
        sql`update purchase_order_lines set accepted_quantity = ${input.acceptedQuantity}, supplier_unit_cost = ${input.supplierUnitCost?.toFixed(2) ?? null}, updated_at = now() where id = ${lineId} and purchase_order_id = ${id} returning id`,
      );
      if (!update.rows[0]) throw new Error('PURCHASE_ORDER_LINE_NOT_FOUND');
      await tx.execute(
        sql`update purchase_orders set status = 'UNDER_OLP_REVIEW', version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_LINE_REVIEWED', lineId, input);
      return this.findByIdOn(tx, id);
    });
  }

  async completeReview(id: string, expectedVersion: number, actor: PurchaseOrderActor) {
    return this.database.db.transaction(async (tx) => {
      const order = await tx.execute<{ version: number; status: string }>(
        sql`select version, status from purchase_orders where id = ${id} for update`,
      );
      const row = order.rows[0];
      if (!row || row.status !== 'UNDER_OLP_REVIEW')
        throw new Error('PURCHASE_ORDER_NOT_REVIEWABLE');
      if (row.version !== expectedVersion)
        return { outcome: 'version_conflict' as const, currentVersion: row.version };
      const counts = await tx.execute<{
        total: number;
        accepted: number;
        positive: number;
        full: number;
      }>(
        sql`select count(*)::int total, count(*) filter (where accepted_quantity is not null)::int accepted, count(*) filter (where accepted_quantity > 0)::int positive, count(*) filter (where accepted_quantity = requested_quantity)::int full from purchase_order_lines where purchase_order_id = ${id}`,
      );
      const c = counts.rows[0]!;
      if (c.total !== c.accepted) throw new Error('PURCHASE_ORDER_REVIEW_INCOMPLETE');
      const status =
        c.positive === 0 ? 'REJECTED' : c.full === c.total ? 'ACCEPTED' : 'PARTIALLY_ACCEPTED';
      await tx.execute(
        sql`update purchase_orders set status = ${status}, version = version + 1, updated_at = now(), updated_by = ${actor.userId} where id = ${id}`,
      );
      await this.audit(tx, actor, 'PURCHASE_ORDER_SUPPLIER_REVIEW_COMPLETED', id, { status });
      return this.findByIdOn(tx, id);
    });
  }

  async list(query: PurchaseOrderListQuery, actor: Scope, supplier = false) {
    const filters = query.status ? [sql`true`] : [sql`po.status <> 'CANCELLED'`];
    if (supplier) filters.push(sql`po.status <> 'DRAFT'`);
    if (query.planningPeriodId)
      filters.push(sql`po.planning_period_id = ${query.planningPeriodId}`);
    if (query.status) filters.push(sql`po.status = ${query.status}`);
    if (query.orderType) filters.push(sql`po.order_type = ${query.orderType}`);
    if (query.purchaseOrderCode)
      filters.push(sql`po.purchase_order_code ilike ${`%${query.purchaseOrderCode}%`}`);
    if (query.commercialCode)
      filters.push(
        sql`exists (select 1 from purchase_order_lines pol where pol.purchase_order_id = po.id and pol.commercial_code = ${query.commercialCode})`,
      );
    if (query.dispensingPointId)
      filters.push(
        sql`exists (select 1 from purchase_order_lines pol where pol.purchase_order_id = po.id and pol.dispensing_point_id = ${query.dispensingPointId})`,
      );
    if (!['MTD', 'MEDICARTE'].includes(actor.organizationCode))
      filters.push(sql`po.organization_id = ${actor.organizationId}`);
    const rows = await this.database.db.execute<{ id: string }>(
      sql`select po.id from purchase_orders po where ${sql.join(filters, sql` and `)} order by po.created_at desc limit ${query.limit}`,
    );
    return Promise.all(rows.rows.map((row) => this.findById(row.id, supplier)));
  }

  findById(id: string, supplier = false) {
    return this.findByIdOn(this.database.db, id, supplier);
  }

  async findVisibleById(id: string, actor: Scope, supplier = false) {
    const visible = await this.database.db.execute<{ id: string }>(sql`
      select po.id from purchase_orders po
      where po.id = ${id}
        and (${actor.organizationCode} = 'MTD' or (${supplier} and po.status <> 'DRAFT'))
    `);
    if (!visible.rows[0]) return null;
    return this.findById(id, supplier);
  }

  async available(planningPeriodId: string) {
    const rows = await this.database.db.execute<{
      id: string;
      commercialCode: string;
      dispensingPointId: string | null;
      dispensingPointCode: string | null;
      dispensingPointName: string | null;
      deliveryPointMapped: boolean;
      revision: number;
      regularQuantity: number;
      lateQuantity: number;
      regularAvailable: number;
      lateAvailable: number;
      regularOverOrdered: number;
      lateOverOrdered: number;
    }>(sql`
      with period_mode as (
        select exists (
          select 1
          from projected_demand_lines
          where planning_period_id = ${planningPeriodId}
            and dispensing_point_id is null
        ) as modern
      ),
      candidate as (
        select
          pdl.*,
          tap.numero_expediente_invima,
          tap.consecutivo_invima_presentacion
        from projected_demand_lines pdl
        join tariff_annex_products tap
          on tap.codigo_producto =
             pdl.commercial_code
         and tap.active = true
         and regexp_replace(
               upper(
                 trim(
                   coalesce(
                     tap.tipo_inclusion,
                     ''
                   )
                 )
               ),
               '\s+',
               '_',
               'g'
             ) = 'PBS'
        cross join period_mode pm
        where pdl.planning_period_id = ${planningPeriodId}
          and (
            (pm.modern and pdl.dispensing_point_id is null)
            or
            (
              not pm.modern
              and pdl.dispensing_point_id is not null
            )
          )
      ),
      ordered as (
        select
          a.projected_demand_line_id,
          pol.commercial_code,
          a.demand_bucket,
          coalesce(
            sum(
              case
                when po.status in (
                  'DRAFT',
                  'ISSUED',
                  'UNDER_OLP_REVIEW'
                )
                  then a.allocated_quantity
                when po.status in (
                  'REJECTED',
                  'CANCELLED'
                )
                  then 0
                else coalesce(
                  pol.accepted_quantity,
                  0
                )
              end
            ),
            0
          )::int as effective_coverage
        from purchase_order_demand_allocations a
        join purchase_order_lines pol
          on pol.id =
             a.purchase_order_line_id
        join purchase_orders po
          on po.id =
             pol.purchase_order_id
        where po.planning_period_id =
              ${planningPeriodId}
        group by
          a.projected_demand_line_id,
          pol.commercial_code,
          a.demand_bucket
      )
      select
        pdl.id,
        pdl.commercial_code as "commercialCode",
        case
          when pdl.dispensing_point_id is null
            then mapped_point.id
          else pdl.dispensing_point_id
        end as "dispensingPointId",

        case
          when pdl.dispensing_point_id is null
            then mapped_point.code
          else historical_point.code
        end as "dispensingPointCode",

        case
          when pdl.dispensing_point_id is null
            then mapped_point.name
          else historical_point.name
        end as "dispensingPointName",

        case
          when pdl.dispensing_point_id is null
            then mapped_point.id is not null
          else true
        end as "deliveryPointMapped",

        pdl.revision,
        pdl.regular_quantity
          as "regularQuantity",
        pdl.late_quantity
          as "lateQuantity",

        case
          when pdl.dispensing_point_id is null
            then greatest(
              pdl.regular_quantity
              -
              (
                coalesce(
                  inv.usable_quantity,
                  0
                )
                +
                coalesce(
                  opc.open_quantity,
                  0
                )
              ),
              0
            )
          else greatest(
            pdl.regular_quantity
            -
            coalesce(
              regular_ordered.effective_coverage,
              0
            ),
            0
          )
        end::int
          as "regularAvailable",

        case
          when pdl.dispensing_point_id is null
            then greatest(
              pdl.late_quantity
              -
              greatest(
                (
                  coalesce(
                    inv.usable_quantity,
                    0
                  )
                  +
                  coalesce(
                    opc.open_quantity,
                    0
                  )
                )
                -
                pdl.regular_quantity,
                0
              ),
              0
            )
          else greatest(
            pdl.late_quantity
            -
            coalesce(
              late_ordered.effective_coverage,
              0
            ),
            0
          )
        end::int
          as "lateAvailable",

        greatest(
          coalesce(
            regular_ordered.effective_coverage,
            0
          )
          -
          pdl.regular_quantity,
          0
        )::int
          as "regularOverOrdered",

        greatest(
          coalesce(
            late_ordered.effective_coverage,
            0
          )
          -
          pdl.late_quantity,
          0
        )::int
          as "lateOverOrdered"

      from candidate pdl

      left join ordered regular_ordered
        on regular_ordered.projected_demand_line_id =
           pdl.id
       and regular_ordered.demand_bucket =
           'REGULAR'

      left join ordered late_ordered
        on late_ordered.projected_demand_line_id =
           pdl.id
       and late_ordered.demand_bucket =
           'LATE'

      left join inventory_usable_by_product inv
        on inv.commercial_code =
           pdl.commercial_code

      left join purchase_open_coverage_by_product opc
        on opc.commercial_code =
           pdl.commercial_code

      left join dispensing_points historical_point
        on historical_point.id =
           pdl.dispensing_point_id

      left join product_delivery_point_mappings mapped
        on pdl.dispensing_point_id is null
       and btrim(
             coalesce(
               pdl.numero_expediente_invima,
               ''
             )
           ) ~ '^[0-9]+$'
       and btrim(
             coalesce(
               pdl.consecutivo_invima_presentacion,
               ''
             )
           ) ~ '^[0-9]+$'
       and mapped.invima_record_normalized =
           coalesce(
             nullif(
               ltrim(
                 btrim(
                   pdl.numero_expediente_invima
                 ),
                 '0'
               ),
               ''
             ),
             '0'
           )
       and mapped.invima_presentation_normalized =
           coalesce(
             nullif(
               ltrim(
                 btrim(
                   pdl.consecutivo_invima_presentacion
                 ),
                 '0'
               ),
               ''
             ),
             '0'
           )

      left join dispensing_points mapped_point
        on mapped_point.id =
           mapped.dispensing_point_id
       and mapped_point.active = true

      order by
        pdl.commercial_code,
        pdl.dispensing_point_id nulls first
    `);

    return rows.rows;
  }

  private async lockDemandLines(tx: Tx, planningPeriodId: string, lines: readonly LineInput[]) {
    const seen = new Set<string>();

    for (const line of lines) {
      if (seen.has(line.projectedDemandLineId)) {
        throw new Error('PURCHASE_ORDER_DUPLICATE_DEMAND_LINE');
      }

      seen.add(line.projectedDemandLineId);
    }

    const ids = [...new Set(lines.map((line) => line.projectedDemandLineId))].sort();

    const locked = await tx.execute<{
      id: string;
      planning_period_id: string;
      dispensing_point_id: string | null;
      commercial_code: string;
      revision: number;
      regular_quantity: number;
      late_quantity: number;
      tarifa_unidad: string | null;
      descripcion_generica: string | null;
      numero_expediente_invima: string | null;
      consecutivo_invima_presentacion: string | null;
    }>(sql`
        select
          pdl.id,
          pdl.planning_period_id,
          pdl.dispensing_point_id,
          pdl.commercial_code,
          pdl.revision,
          pdl.regular_quantity,
          pdl.late_quantity,
          tap.tarifa_unidad,
          tap.descripcion_generica,
          tap.numero_expediente_invima,
          tap.consecutivo_invima_presentacion
        from projected_demand_lines pdl
        left join tariff_annex_products tap
          on tap.codigo_producto =
             pdl.commercial_code
         and tap.active = true
        where pdl.id in (
          ${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )}
        )
        order by pdl.id
        for update of pdl
      `);

    if (locked.rows.length !== ids.length) {
      throw new Error('PROJECTED_DEMAND_LINE_NOT_FOUND');
    }

    const modernCodes = [
      ...new Set(
        locked.rows
          .filter((row) => row.dispensing_point_id === null)
          .map((row) => row.commercial_code),
      ),
    ].sort();

    // Cross-period / recreated-demand concurrency guard:
    // procurement availability is product-scoped, therefore the lock must
    // also be product-scoped rather than only projected-demand-line scoped.
    for (const commercialCode of modernCodes) {
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtext(
            ${`PROCUREMENT:${commercialCode}`}
          )
        )
      `);
    }

    for (const line of lines) {
      const demand = locked.rows.find((item) => item.id === line.projectedDemandLineId)!;

      if (demand.planning_period_id !== planningPeriodId) {
        throw new Error('PURCHASE_ORDER_DEMAND_PERIOD_MISMATCH');
      }

      if (demand.revision !== line.expectedDemandRevision) {
        throw new Error('PROJECTED_DEMAND_REVISION_CONFLICT');
      }

      /*
       * Macro 4A.
       *
       * La elegibilidad de una compra nueva se vuelve a validar
       * contra el Anexo Tarifario vigente dentro de la misma
       * transacción que materializa la OC.
       *
       * FOR SHARE serializa este punto contra CONFIRM del AT,
       * que bloquea la fila del producto con FOR UPDATE.
       */
      const currentTariff = await tx.execute<{
        tarifa_unidad: string | null;
        tipo_inclusion: string | null;
        numero_expediente_invima: string | null;
        consecutivo_invima_presentacion: string | null;
      }>(sql`
        select
          tarifa_unidad,
          tipo_inclusion,
          numero_expediente_invima,
          consecutivo_invima_presentacion
        from tariff_annex_products
        where codigo_producto =
              ${demand.commercial_code}
          and active = true
        for share
      `);

      const currentTariffRow = currentTariff.rows[0];

      const currentTariffInclusion = (currentTariffRow?.tipo_inclusion ?? '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');

      if (!currentTariffRow || currentTariffInclusion !== 'PBS') {
        throw new Error('PURCHASE_ORDER_TARIFF_NOT_PBS');
      }

      if (!currentTariffRow.tarifa_unidad) {
        throw new Error('TARIFF_RATE_NOT_FOUND');
      }

      if (demand.dispensing_point_id === null) {
        if (line.dispensingPointId !== undefined) {
          throw new Error('PURCHASE_ORDER_MODERN_DEMAND_POINT_NOT_ALLOWED');
        }

        /*
         * Wave 2A.
         *
         * La sede logística no viene del paciente ni del request.
         * Se deriva del maestro producto/presentación -> sede Medicarte.
         *
         * La resolución ocurre dentro de la misma transacción de creación
         * de OC para impedir usar una relación logística obsoleta.
         */
        await this.resolveProductDeliveryPoint(
          tx,
          currentTariffRow.numero_expediente_invima,
          currentTariffRow.consecutivo_invima_presentacion,
        );

        const supply = await tx.execute<{
          usable_stock: number;
          open_purchase_coverage: number;
        }>(sql`
            select
              coalesce(
                (
                  select usable_quantity
                  from inventory_usable_by_product
                  where commercial_code =
                        ${demand.commercial_code}
                ),
                0
              )::int as usable_stock,

              coalesce(
                (
                  select open_quantity
                  from purchase_open_coverage_by_product
                  where commercial_code =
                        ${demand.commercial_code}
                ),
                0
              )::int
                as open_purchase_coverage
          `);

        const usableStock = Number(supply.rows[0]?.usable_stock ?? 0);

        const openCoverage = Number(supply.rows[0]?.open_purchase_coverage ?? 0);

        const offset = usableStock + openCoverage;

        const regularAvailable = Math.max(demand.regular_quantity - offset, 0);

        const remainingOffset = Math.max(offset - demand.regular_quantity, 0);

        const lateAvailable = Math.max(demand.late_quantity - remainingOffset, 0);

        const available = line.demandBucket === 'REGULAR' ? regularAvailable : lateAvailable;

        if (line.requestedQuantity > available) {
          throw new Error('PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE');
        }

        continue;
      }

      // Historical point-based demand compatibility.
      const effectivePoint = line.dispensingPointId ?? demand.dispensing_point_id;

      const point = await tx.execute<{
        id: string;
      }>(sql`
          select id
          from dispensing_points
          where id =
                ${effectivePoint}
            and active = true
        `);

      if (!point.rows[0]) {
        throw new Error('DISPENSING_POINT_NOT_FOUND');
      }

      if (effectivePoint !== demand.dispensing_point_id) {
        throw new Error('PURCHASE_ORDER_DEMAND_POINT_MISMATCH');
      }

      const coverage = await tx.execute<{
        quantity: number;
      }>(sql`
          select
            coalesce(
              sum(
                case
                  when po.status in (
                    'DRAFT',
                    'ISSUED',
                    'UNDER_OLP_REVIEW'
                  )
                    then
                      a.allocated_quantity

                  when po.status in (
                    'REJECTED',
                    'CANCELLED'
                  )
                    then 0

                  else
                    coalesce(
                      pol.accepted_quantity,
                      0
                    )
                end
              ),
              0
            )::int as quantity

          from purchase_order_demand_allocations a

          join purchase_order_lines pol
            on pol.id =
               a.purchase_order_line_id

          join purchase_orders po
            on po.id =
               pol.purchase_order_id

          where
            a.projected_demand_line_id =
              ${demand.id}

            and a.demand_bucket =
              ${line.demandBucket}
        `);

      const historicalDemand =
        line.demandBucket === 'REGULAR' ? demand.regular_quantity : demand.late_quantity;

      if (line.requestedQuantity > historicalDemand - Number(coverage.rows[0]?.quantity ?? 0)) {
        throw new Error('PURCHASE_ORDER_DEMAND_EXCEEDS_AVAILABLE');
      }
    }
  }

  private async resolveProductDeliveryPoint(
    tx: Tx,
    invimaRecordRaw: string | null,
    invimaPresentationRaw: string | null,
  ): Promise<{
    id: string;
    code: string;
    name: string;
  }> {
    const invimaRecord = normalizeInvimaComponent(invimaRecordRaw);

    const invimaPresentation = normalizeInvimaComponent(invimaPresentationRaw);

    if (!invimaRecord || !invimaPresentation) {
      throw new Error('DELIVERY_POINT_MAPPING_MISSING');
    }

    const mapping = await tx.execute<{
      id: string;
      code: string;
      name: string;
    }>(sql`
      select
        dp.id,
        dp.code,
        dp.name
      from product_delivery_point_mappings m
      join dispensing_points dp
        on dp.id = m.dispensing_point_id
       and dp.active = true
      where m.invima_record_normalized =
            ${invimaRecord}
        and m.invima_presentation_normalized =
            ${invimaPresentation}
      for share of m, dp
    `);

    const point = mapping.rows[0];

    if (!point) {
      throw new Error('DELIVERY_POINT_MAPPING_MISSING');
    }

    return point;
  }

  private async replaceLines(
    tx: Tx,
    orderId: string,
    lines: readonly LineInput[],
    orderType: string,
  ) {
    for (const line of lines) {
      const demand = await tx.execute<{
        commercial_code: string;
        dispensing_point_id: string | null;
        tarifa_unidad: string;
        descripcion_generica: string | null;
        numero_expediente_invima: string | null;
        consecutivo_invima_presentacion: string | null;
      }>(
        sql`select pdl.commercial_code, pdl.dispensing_point_id, tap.tarifa_unidad, tap.descripcion_generica, tap.numero_expediente_invima, tap.consecutivo_invima_presentacion from projected_demand_lines pdl join tariff_annex_products tap on tap.codigo_producto = pdl.commercial_code and tap.active = true and regexp_replace(upper(trim(coalesce(tap.tipo_inclusion, ''))), '\\s+', '_', 'g') = 'PBS' where pdl.id = ${line.projectedDemandLineId}`,
      );

      const d = demand.rows[0]!;

      let dispensingPointId = line.dispensingPointId ?? d.dispensing_point_id ?? null;

      if (d.dispensing_point_id === null) {
        const mappedPoint = await this.resolveProductDeliveryPoint(
          tx,
          d.numero_expediente_invima,
          d.consecutivo_invima_presentacion,
        );

        dispensingPointId = mappedPoint.id;
      }

      if (!dispensingPointId) {
        throw new Error('DELIVERY_POINT_MAPPING_MISSING');
      }

      const inserted = await tx.execute<{ id: string }>(
        sql`insert into purchase_order_lines (purchase_order_id, commercial_code, product_description, presentation, dispensing_point_id, requested_quantity, requested_delivery_date, compensar_unit_rate_snapshot, projected_demand_line_id, projected_demand_revision, demand_bucket) values (${orderId}, ${d.commercial_code}, ${d.descripcion_generica}, ${d.consecutivo_invima_presentacion}, ${dispensingPointId}, ${line.requestedQuantity}, ${line.requestedDeliveryDate ?? null}, ${d.tarifa_unidad}, ${line.projectedDemandLineId}, ${line.expectedDemandRevision}, ${line.demandBucket}) returning id`,
      );
      await tx.execute(
        sql`insert into purchase_order_demand_allocations (purchase_order_line_id, projected_demand_line_id, projected_demand_revision, demand_bucket, allocated_quantity) values (${inserted.rows[0]!.id}, ${line.projectedDemandLineId}, ${line.expectedDemandRevision}, ${line.demandBucket}, ${line.requestedQuantity})`,
      );

      await tx.execute(sql`
        insert into purchase_order_authorization_sources (
          purchase_order_line_id,
          authorization_item_id,
          projected_demand_line_id,
          projected_demand_revision,
          source_quantity_snapshot
        )
        select
          ${inserted.rows[0]!.id},
          ds.authorization_item_id,
          ${line.projectedDemandLineId},
          ${line.expectedDemandRevision},
          ds.quantity
        from demand_sources ds
        where ds.projected_demand_line_id = ${line.projectedDemandLineId}
          and ds.authorization_item_id is not null
        on conflict (
          purchase_order_line_id,
          authorization_item_id
        ) do nothing
      `);

      if (orderType === 'STANDARD' && line.demandBucket !== 'REGULAR')
        throw new Error('PURCHASE_ORDER_BUCKET_MISMATCH');
    }
  }

  private async findByIdOn(conn: Tx | Database['db'], id: string, supplier = false) {
    const rows = await conn.execute<PurchaseOrderJoinedRow>(
      sql`select po.id, po.purchase_order_code, po.planning_period_id, po.order_type, po.status, po.version, po.issued_at, po.issued_by, po.created_at, po.updated_at, pol.id as line_id, pol.commercial_code, pol.product_description, pol.presentation, pol.dispensing_point_id, dp.code as dispensing_point_code, dp.name as dispensing_point_name, pol.requested_quantity, pol.accepted_quantity, pol.requested_delivery_date, pol.compensar_unit_rate_snapshot, pol.supplier_unit_cost, pol.projected_demand_line_id, pol.projected_demand_revision, pol.demand_bucket, a.allocated_quantity, pdl.revision as current_demand_revision from purchase_orders po left join purchase_order_lines pol on pol.purchase_order_id = po.id left join purchase_order_demand_allocations a on a.purchase_order_line_id = pol.id left join dispensing_points dp on dp.id = pol.dispensing_point_id left join projected_demand_lines pdl on pdl.id = pol.projected_demand_line_id where po.id = ${id} order by pol.id`,
    );
    const first = rows.rows[0];
    if (!first) return null;
    return {
      id: first.id,
      purchaseOrderCode: first.purchase_order_code,
      planningPeriodId: first.planning_period_id,
      orderType: first.order_type,
      status: first.status,
      version: first.version,
      issuedAt: first.issued_at,
      issuedBy: first.issued_by,
      createdAt: first.created_at,
      updatedAt: first.updated_at,
      lines: rows.rows
        .filter((r) => r.line_id)
        .map((r) => ({
          id: r.line_id,
          commercialCode: r.commercial_code,
          productDescription: r.product_description,
          presentation: r.presentation,
          dispensingPointId: r.dispensing_point_id,
          dispensingPointCode: r.dispensing_point_code,
          dispensingPointName: r.dispensing_point_name,
          requestedQuantity: r.requested_quantity,
          acceptedQuantity: r.accepted_quantity,
          shortage: (r.requested_quantity ?? 0) - (r.accepted_quantity ?? 0),
          requestedDeliveryDate: r.requested_delivery_date,
          compensarUnitRateSnapshot: r.compensar_unit_rate_snapshot,
          supplierUnitCost: supplier ? r.supplier_unit_cost : r.supplier_unit_cost,
          projectedDemandLineId: r.projected_demand_line_id,
          projectedDemandRevision: r.projected_demand_revision,
          demandBucket: r.demand_bucket,
          allocatedQuantity: r.allocated_quantity,
          sourceDemandChanged: r.current_demand_revision !== r.projected_demand_revision,
        })),
    };
  }

  private async audit(
    tx: Tx,
    actor: PurchaseOrderActor,
    action: string,
    resourceId: string,
    after: unknown,
  ) {
    await tx.execute(
      sql`insert into audit_events (actor_type, actor_id, organization_id, action, resource_type, resource_id, after, correlation_id, request_id, result) values ('USER', ${actor.userId}, ${actor.organizationId}, ${action}, 'purchase_order', ${resourceId}, ${after ? JSON.stringify(after) : null}::jsonb, ${actor.correlationId}, ${actor.correlationId}, 'SUCCESS')`,
    );
  }
}
