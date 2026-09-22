import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  AnalyticsDrilldownKind,
  AnalyticsDrilldownQuery,
  AnalyticsQuery,
  PatientOperationalNovelty,
} from '@authorization/contracts';
import type { createDatabase } from '@authorization/database';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;

const NOVELTY_CODES: PatientOperationalNovelty[] = [
  'PATIENT_NO_SHOW',
  'INCORRECT_PRESCRIPTION',
  'PRODUCT_NOT_CONTRACTED',
  'AUTHORIZATION_CANCELLED',
  'INSUFFICIENT_STOCK',
  'RESCHEDULED',
  'OTHER',
];

export type QuantitySnapshot = {
  regularProjectedQuantity: number;
  lateProjectedQuantity: number;
  lastConsolidatedAt: string | null;
  demandStale: boolean;
  requestedQuantity: number;
  acceptedQuantity: number;
  effectivePurchaseCoverage: number;
  dispatchedQuantity: number;
  physicallyReceivedQuantity: number;
  acceptedIntoInventoryQuantity: number;
  rejectedQuantity: number;
  receiptPhysicalShortageQuantity: number;
  appliedQuantity: number;
  nonReusableQuantity: number;
  currentOnHandQuantity: number;
  usableBalance: number;
  inTransitQuantity: number;
  expiredPhysicalQuantity: number;
  upcomingExpirationQuantity: number;
  notAppliedCount: number;
  noShowCount: number;
  confirmedApplicationCount: number;
  readyForAudit: number;
  inReview: number;
  approved: number;
  rejected: number;
  requestedSupplierValue: string | null;
  acceptedSupplierValue: string | null;
  dispatchedSupplierValue: string | null;
  acceptedReceiptSupplierValue: string | null;
  requestedTariffSnapshotValue: string | null;
  acceptedTariffSnapshotValue: string | null;
  /** Period-effective tariff only. Never the live annex `active=true` row. */
  projectedTariffReferenceValue: string | null;
};

export type NoveltyCount = { noveltyCode: PatientOperationalNovelty; count: number };

function asInt(value: unknown): number {
  return Number(value ?? 0);
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

function asMoney(value: unknown): string | null {
  const text = asText(value);
  if (text == null || text === '') return null;
  return /^-?\d+\.\d{2}$/.test(text) ? text : null;
}

function asTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const text = asText(value);
  if (text == null || text === '') return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async snapshot(query: AnalyticsQuery): Promise<QuantitySnapshot> {
    const period = query.planningPeriodId
      ? sql`po.planning_period_id = ${query.planningPeriodId}`
      : sql`true`;
    const demandPeriod = query.planningPeriodId
      ? sql`pdl.planning_period_id = ${query.planningPeriodId}`
      : sql`true`;
    const point = query.dispensingPointId
      ? sql`pol.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const demandPoint = query.dispensingPointId
      ? sql`pdl.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const code = query.commercialCode
      ? sql`pol.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const demandCode = query.commercialCode
      ? sql`pdl.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const orderType = query.orderType ? sql`po.order_type = ${query.orderType}` : sql`true`;
    const bucket = query.demandBucket ? sql`pol.demand_bucket = ${query.demandBucket}` : sql`true`;
    const allocationBucket = query.demandBucket
      ? sql`a.demand_bucket = ${query.demandBucket}`
      : sql`true`;
    const deliveryDate = this.dateRange(query, sql`d.dispatched_at::date`);
    const receiptDate = this.dateRange(query, sql`r.received_at::date`);
    const applicationDate = this.dateRange(query, sql`pa.application_date`);
    const outcomeDate = this.dateRange(query, sql`pso.occurred_on`);
    const applicationStatus = query.operationalStatus === 'NOT_APPLIED' ? sql`false` : sql`true`;
    const outcomeStatus = query.operationalStatus === 'APPLIED' ? sql`false` : sql`true`;
    const novelty = query.noveltyCode ? sql`pso.novelty_code = ${query.noveltyCode}` : sql`true`;
    const regularQty =
      query.demandBucket === 'LATE' ? sql`0` : sql`coalesce(sum(pdl.regular_quantity), 0)`;
    const lateQty =
      query.demandBucket === 'REGULAR' ? sql`0` : sql`coalesce(sum(pdl.late_quantity), 0)`;
    const schedulePeriod = query.planningPeriodId
      ? sql`(ps.planning_period_id = ${query.planningPeriodId} or ps.deferred_planning_period_id = ${query.planningPeriodId})`
      : sql`true`;
    const schedulePoint = query.dispensingPointId
      ? sql`ps.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const scheduleCode = query.commercialCode
      ? sql`ps.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const appPoint = query.dispensingPointId
      ? sql`pa.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const appCode = query.commercialCode
      ? sql`pa.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const appPeriod = query.planningPeriodId
      ? sql`(ps.planning_period_id = ${query.planningPeriodId} or ps.deferred_planning_period_id = ${query.planningPeriodId})`
      : sql`true`;
    const lotPoint = query.dispensingPointId
      ? sql`l.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const lotCode = query.commercialCode
      ? sql`l.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const transferPoint = query.dispensingPointId
      ? sql`(st.source_dispensing_point_id = ${query.dispensingPointId} or st.destination_dispensing_point_id = ${query.dispensingPointId})`
      : sql`true`;
    const transferCode = query.commercialCode
      ? sql`stl.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const auditStatus =
      query.auditStatus === 'READY_FOR_AUDIT'
        ? sql`paa.id is null`
        : query.auditStatus
          ? sql`paa.status = ${query.auditStatus}`
          : sql`true`;
    const auditReadyOnly =
      query.auditStatus && query.auditStatus !== 'READY_FOR_AUDIT' ? sql`false` : sql`true`;
    const auditPersisted =
      !query.auditStatus || query.auditStatus === 'READY_FOR_AUDIT'
        ? sql`true`
        : sql`paa.status = ${query.auditStatus}`;

    const row = (
      await this.database.db.execute<Record<string, unknown>>(sql`
        with demand as (
          select ${regularQty}::int regular_projected_quantity,
                 ${lateQty}::int late_projected_quantity,
                 to_char(max(pdl.consolidated_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') last_consolidated_at
          from projected_demand_lines pdl
          where ${demandPeriod} and ${demandPoint} and ${demandCode}
        ),
        stale as (
          select exists (
            select 1 from patient_schedules ps
            where ps.status in ('SCHEDULED', 'RESCHEDULED')
              and ${schedulePeriod} and ${schedulePoint} and ${scheduleCode}
              and not exists (
                select 1 from demand_sources ds
                join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
                where ds.patient_schedule_id = ps.id
                  and ds.schedule_revision = ps.revision
                  and ${demandPeriod}
              )
          ) or exists (
            select 1 from demand_sources ds
            join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
            join patient_schedules ps on ps.id = ds.patient_schedule_id
            where ${demandPeriod} and ${demandPoint} and ${demandCode}
              and (ps.revision <> ds.schedule_revision or ps.status = 'CANCELLED')
          ) as demand_stale
        ),
        issued as (
          select pol.id, pol.requested_quantity, coalesce(pol.accepted_quantity, 0) accepted_quantity,
                 pol.supplier_unit_cost, pol.compensar_unit_rate_snapshot
          from purchase_order_lines pol
          join purchase_orders po on po.id = pol.purchase_order_id
          where po.status not in ('DRAFT', 'CANCELLED')
            and ${period} and ${point} and ${code} and ${orderType} and ${bucket}
        ),
        coverage as (
          select coalesce(sum(case
            when po.status in ('DRAFT', 'ISSUED', 'UNDER_OLP_REVIEW') then a.allocated_quantity
            when po.status in ('REJECTED', 'CANCELLED') then 0
            else coalesce(pol.accepted_quantity, 0)
          end), 0)::int effective_purchase_coverage
          from purchase_order_demand_allocations a
          join purchase_order_lines pol on pol.id = a.purchase_order_line_id
          join purchase_orders po on po.id = pol.purchase_order_id
          where ${period} and ${point} and ${code} and ${orderType} and ${allocationBucket}
        ),
        dispatched as (
          select coalesce(sum(dl.quantity), 0)::int dispatched_quantity,
                 case when count(*) = 0 then null
                      when count(*) filter (where pol.supplier_unit_cost is null) > 0 then null
                      else trim(to_char(sum(dl.quantity * pol.supplier_unit_cost::numeric), 'FM999999999999990.00'))
                 end dispatched_supplier_value
          from delivery_lines dl
          join deliveries d on d.id = dl.delivery_id
          join purchase_order_lines pol on pol.id = dl.purchase_order_line_id
          join purchase_orders po on po.id = pol.purchase_order_id
          where d.status in ('DISPATCHED', 'RECEIVED')
            and ${period} and ${point} and ${code} and ${orderType} and ${bucket} and ${deliveryDate}
        ),
        received as (
          select coalesce(sum(rl.received_quantity), 0)::int physically_received_quantity,
                 coalesce(sum(rl.accepted_quantity), 0)::int accepted_into_inventory_quantity,
                 coalesce(sum(rl.rejected_quantity), 0)::int rejected_quantity,
                 coalesce(sum(rl.shortage_quantity), 0)::int receipt_physical_shortage_quantity,
                 case when count(*) = 0 then null
                      when count(*) filter (where pol.supplier_unit_cost is null) > 0 then null
                      else trim(to_char(sum(rl.accepted_quantity * pol.supplier_unit_cost::numeric), 'FM999999999999990.00'))
                 end accepted_receipt_supplier_value
          from receipt_lines rl
          join receipts r on r.id = rl.receipt_id
          join delivery_lines dl on dl.id = rl.delivery_line_id
          join purchase_order_lines pol on pol.id = dl.purchase_order_line_id
          join purchase_orders po on po.id = pol.purchase_order_id
          where r.status = 'CONFIRMED'
            and ${period} and ${point} and ${code} and ${orderType} and ${bucket} and ${receiptDate}
        ),
        applied as (
          select coalesce(sum(pal.quantity), 0)::int applied_quantity,
                 count(distinct pa.id)::int confirmed_application_count
          from patient_application_lines pal
          join patient_applications pa on pa.id = pal.patient_application_id
          join patient_schedules ps on ps.id = pa.patient_schedule_id
          where pa.status = 'CONFIRMED' and ${applicationStatus}
            and ${appPeriod} and ${appPoint} and ${appCode} and ${applicationDate}
        ),
        outcomes as (
          select count(*)::int not_applied_count,
                 count(*) filter (where pso.novelty_code = 'PATIENT_NO_SHOW')::int no_show_count
          from patient_schedule_outcomes pso
          join patient_schedules ps on ps.id = pso.patient_schedule_id
          where ${outcomeStatus} and ${novelty} and ${schedulePeriod} and ${schedulePoint}
            and ${scheduleCode} and ${outcomeDate}
        ),
        non_reusable as (
          select coalesce(sum(abs(m.quantity_delta)), 0)::int non_reusable_quantity
          from inventory_movements m
          join inventory_lots l on l.id = m.inventory_lot_id
          where m.movement_type = 'NON_REUSABLE' and ${lotPoint} and ${lotCode}
        ),
        inventory as (
          select coalesce(sum(m.quantity_delta), 0)::int current_on_hand_quantity,
                 coalesce(sum(case when l.expiration_date < current_date then 0 else m.quantity_delta end), 0)::int usable_balance,
                 coalesce(sum(case when l.expiration_date < current_date then m.quantity_delta else 0 end), 0)::int expired_physical_quantity,
                 coalesce(sum(case when l.expiration_date >= current_date and l.expiration_date <= current_date + 30
                   then m.quantity_delta else 0 end), 0)::int upcoming_expiration_quantity
          from inventory_lots l
          left join inventory_movements m on m.inventory_lot_id = l.id
          where ${lotPoint} and ${lotCode}
        ),
        transit as (
          select coalesce(sum(stl.quantity), 0)::int in_transit_quantity
          from stock_transfer_lines stl
          join stock_transfers st on st.id = stl.stock_transfer_id
          where st.status = 'DISPATCHED' and ${transferPoint} and ${transferCode}
        ),
        audits as (
          select
            count(*) filter (where paa.id is null and ${auditReadyOnly})::int ready_for_audit,
            count(*) filter (where paa.status = 'IN_REVIEW' and ${auditPersisted})::int in_review,
            count(*) filter (where paa.status = 'APPROVED' and ${auditPersisted})::int approved,
            count(*) filter (where paa.status = 'REJECTED' and ${auditPersisted})::int rejected
          from patient_applications pa
          join patient_schedules ps on ps.id = pa.patient_schedule_id
          left join patient_application_audits paa on paa.patient_application_id = pa.id
          where pa.status = 'CONFIRMED'
            and not exists (
              select 1 from patient_schedule_outcomes pso
              where pso.patient_schedule_id = pa.patient_schedule_id
                and pso.schedule_revision = pa.schedule_revision
            )
            and ${appPeriod} and ${appPoint} and ${appCode} and ${applicationDate} and ${auditStatus}
        )
        select d.regular_projected_quantity, d.late_projected_quantity, d.last_consolidated_at, s.demand_stale,
          (select coalesce(sum(requested_quantity), 0)::int from issued) requested_quantity,
          (select coalesce(sum(accepted_quantity), 0)::int from issued) accepted_quantity,
          c.effective_purchase_coverage,
          disp.dispatched_quantity, rec.physically_received_quantity, rec.accepted_into_inventory_quantity,
          rec.rejected_quantity, rec.receipt_physical_shortage_quantity,
          app.applied_quantity, nr.non_reusable_quantity, inv.current_on_hand_quantity, inv.usable_balance,
          tr.in_transit_quantity, inv.expired_physical_quantity, inv.upcoming_expiration_quantity,
          oc.not_applied_count, oc.no_show_count, app.confirmed_application_count,
          au.ready_for_audit, au.in_review, au.approved, au.rejected,
          (select case when count(*) = 0 then null
                       when count(*) filter (where supplier_unit_cost is null) > 0 then null
                       else trim(to_char(sum(requested_quantity * supplier_unit_cost::numeric), 'FM999999999999990.00'))
                  end from issued) requested_supplier_value,
          (select case when count(*) = 0 then null
                       when count(*) filter (where supplier_unit_cost is null) > 0 then null
                       else trim(to_char(sum(accepted_quantity * supplier_unit_cost::numeric), 'FM999999999999990.00'))
                  end from issued) accepted_supplier_value,
          disp.dispatched_supplier_value, rec.accepted_receipt_supplier_value,
          (select case when count(*) = 0 then null
                       else trim(to_char(sum(requested_quantity * compensar_unit_rate_snapshot::numeric), 'FM999999999999990.00'))
                  end from issued) requested_tariff_snapshot_value,
          (select case when count(*) = 0 then null
                       else trim(to_char(sum(accepted_quantity * compensar_unit_rate_snapshot::numeric), 'FM999999999999990.00'))
                  end from issued) accepted_tariff_snapshot_value
        from demand d
        cross join stale s
        cross join coverage c
        cross join dispatched disp
        cross join received rec
        cross join applied app
        cross join outcomes oc
        cross join non_reusable nr
        cross join inventory inv
        cross join transit tr
        cross join audits au
      `)
    ).rows[0];

    return {
      regularProjectedQuantity: asInt(row?.regular_projected_quantity),
      lateProjectedQuantity: asInt(row?.late_projected_quantity),
      lastConsolidatedAt: asTimestamp(row?.last_consolidated_at),
      demandStale: Boolean(row?.demand_stale),
      requestedQuantity: asInt(row?.requested_quantity),
      acceptedQuantity: asInt(row?.accepted_quantity),
      effectivePurchaseCoverage: asInt(row?.effective_purchase_coverage),
      dispatchedQuantity: asInt(row?.dispatched_quantity),
      physicallyReceivedQuantity: asInt(row?.physically_received_quantity),
      acceptedIntoInventoryQuantity: asInt(row?.accepted_into_inventory_quantity),
      rejectedQuantity: asInt(row?.rejected_quantity),
      receiptPhysicalShortageQuantity: asInt(row?.receipt_physical_shortage_quantity),
      appliedQuantity: asInt(row?.applied_quantity),
      nonReusableQuantity: asInt(row?.non_reusable_quantity),
      currentOnHandQuantity: asInt(row?.current_on_hand_quantity),
      usableBalance: Math.max(asInt(row?.usable_balance), 0),
      inTransitQuantity: asInt(row?.in_transit_quantity),
      expiredPhysicalQuantity: Math.max(asInt(row?.expired_physical_quantity), 0),
      upcomingExpirationQuantity: Math.max(asInt(row?.upcoming_expiration_quantity), 0),
      notAppliedCount: asInt(row?.not_applied_count),
      noShowCount: asInt(row?.no_show_count),
      confirmedApplicationCount: asInt(row?.confirmed_application_count),
      readyForAudit: asInt(row?.ready_for_audit),
      inReview: asInt(row?.in_review),
      approved: asInt(row?.approved),
      rejected: asInt(row?.rejected),
      requestedSupplierValue: asMoney(row?.requested_supplier_value),
      acceptedSupplierValue: asMoney(row?.accepted_supplier_value),
      dispatchedSupplierValue: asMoney(row?.dispatched_supplier_value),
      acceptedReceiptSupplierValue: asMoney(row?.accepted_receipt_supplier_value),
      requestedTariffSnapshotValue: asMoney(row?.requested_tariff_snapshot_value),
      acceptedTariffSnapshotValue: asMoney(row?.accepted_tariff_snapshot_value),
      // Live annex `active=true` is not period-effective lineage. ESP-013 does not invent tariff history.
      projectedTariffReferenceValue: null,
    };
  }


  async dashboard(input: {
    organizationId: string;
    organizationCode: string;
    includeEconomics: boolean;
  }) {
    const scopeValues = [
      input.organizationId,
      input.organizationCode,
    ];

    /*
     * El funnel es authorization-based.
     *
     * "Pasó primer filtro" significa elegible para compra hoy:
     * - estado fuente 5 / ENABLED
     * - PBS
     * - listado en Anexo Tarifario
     * - cantidad fuente válida
     * - asignación dentro del mes operacional vigente
     * - vigencia no expirada
     *
     * Las etapas posteriores usan provenance de compra.
     * Esto NO reserva inventario ni lotes por paciente/AUTO.
     */
    const authorizations =
      await this.database.pool.query<Record<string, unknown>>(
        `
        with scoped_authorizations as (
          select ai.*
          from authorization_items ai
          where
            $2::text = 'MTD'
            or exists (
              select 1
              from authorization_item_organizations aio
              where aio.authorization_item_id = ai.id
                and aio.organization_id = $1::uuid
            )
        ),
        evaluated as (
          select
            ai.id,
            ai.coverage_type,

            (
              ai.source_status_normalized = '5'
              and ai.enablement_status = 'ENABLED'
              and ai.coverage_type = 'PBS'
              and ai.tariff_membership_status = 'LISTED'

              and coalesce(
                ai.source_data->>'CANTIDAD',
                ''
              ) ~ '^[1-9][0-9]*$'

              and case
                when coalesce(
                  ai.source_data->>'FECHA_ASIGNACION',
                  ''
                ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                then
                  (ai.source_data->>'FECHA_ASIGNACION')::date
                  <= (
                    date_trunc(
                      'month',
                      (now() at time zone 'America/Bogota')::date
                    )
                    + interval '1 month - 1 day'
                  )::date
                else false
              end

              and case
                when coalesce(
                  ai.source_data->>'FECHA_FINAL_VIGENCIA',
                  ''
                ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                then
                  (ai.source_data->>'FECHA_FINAL_VIGENCIA')::date
                  >= (now() at time zone 'America/Bogota')::date
                else false
              end
            ) as purchase_eligible,

            coalesce(
              bool_or(
                po.id is not null
                and po.status not in ('DRAFT', 'CANCELLED')
              ),
              false
            ) as has_purchase_order,

            coalesce(
              bool_or(
                po.status in (
                  'ACCEPTED',
                  'PARTIALLY_ACCEPTED',
                  'REJECTED',
                  'IN_FULFILLMENT',
                  'PARTIALLY_DISPATCHED',
                  'FULLY_DISPATCHED',
                  'PARTIALLY_RECEIVED',
                  'RECEIVED'
                )
              ),
              false
            ) as supplier_managed,

            coalesce(
              bool_or(
                r.status = 'CONFIRMED'
                and rl.accepted_quantity > 0
              ),
              false
            ) as received_at_point

          from scoped_authorizations ai

          left join purchase_order_authorization_sources poas
            on poas.authorization_item_id = ai.id

          left join purchase_order_lines pol
            on pol.id = poas.purchase_order_line_id

          left join purchase_orders po
            on po.id = pol.purchase_order_id

          left join delivery_lines dl
            on dl.purchase_order_line_id = pol.id

          left join receipt_lines rl
            on rl.delivery_line_id = dl.id

          left join receipts r
            on r.id = rl.receipt_id

          group by
            ai.id,
            ai.coverage_type,
            ai.source_status_normalized,
            ai.enablement_status,
            ai.tariff_membership_status,
            ai.source_data
        )

        select
          count(*)::int
            as total,

          count(*) filter (
            where purchase_eligible
          )::int
            as passed_first_filter,

          count(*) filter (
            where purchase_eligible
              and has_purchase_order
          )::int
            as purchase_order_issued,

          count(*) filter (
            where purchase_eligible
              and supplier_managed
          )::int
            as supplier_managed,

          count(*) filter (
            where purchase_eligible
              and received_at_point
          )::int
            as received_at_point,

          count(*) filter (
            where coverage_type = 'PBS'
          )::int
            as pbs,

          count(*) filter (
            where coverage_type = 'NO_PBS'
          )::int
            as no_pbs

        from evaluated
        `,
        scopeValues,
      );

    const noveltySummary =
      await this.database.pool.query<Record<string, unknown>>(
        `
        select
          count(*)::int as active_novelty_count,

          count(
            distinct n.authorization_item_id
          )::int as affected_authorization_count

        from novelties n

        join authorization_items ai
          on ai.id = n.authorization_item_id

        where n.active = true
          and n.authorization_item_id is not null
          and (
            $2::text = 'MTD'
            or exists (
              select 1
              from authorization_item_organizations aio
              where aio.authorization_item_id = ai.id
                and aio.organization_id = $1::uuid
            )
          )
        `,
        scopeValues,
      );

    const noveltyByCause =
      await this.database.pool.query<Record<string, unknown>>(
        `
        select
          n.code,

          max(
            coalesce(
              nullif(nc.description, ''),
              nullif(n.description, ''),
              n.code
            )
          ) as description,

          count(
            distinct n.authorization_item_id
          )::int as affected_authorization_count,

          count(*)::int as novelty_count

        from novelties n

        join authorization_items ai
          on ai.id = n.authorization_item_id

        left join novelty_codes nc
          on nc.code = n.code

        where n.active = true
          and n.authorization_item_id is not null
          and (
            $2::text = 'MTD'
            or exists (
              select 1
              from authorization_item_organizations aio
              where aio.authorization_item_id = ai.id
                and aio.organization_id = $1::uuid
            )
          )

        group by n.code

        order by
          count(
            distinct n.authorization_item_id
          ) desc,
          n.code
        `,
        scopeValues,
      );

    const inventory =
      await this.database.pool.query<Record<string, unknown>>(
        `
        with scoped_lots as (
          select
            il.id,
            il.commercial_code,
            il.expiration_date,
            il.dispensing_point_id

          from inventory_lots il

          join dispensing_points dp
            on dp.id = il.dispensing_point_id

          where
            $2::text = 'MTD'
            or dp.organization_id = $1::uuid
        ),

        lot_balances as (
          select
            sl.id,
            sl.commercial_code,
            sl.expiration_date,
            sl.dispensing_point_id,

            coalesce(
              sum(im.quantity_delta),
              0
            )::bigint as balance

          from scoped_lots sl

          left join inventory_movements im
            on im.inventory_lot_id = sl.id

          group by
            sl.id,
            sl.commercial_code,
            sl.expiration_date,
            sl.dispensing_point_id
        ),

        usable_products as (
          select
            commercial_code,

            sum(balance)::bigint
              as usable_quantity,

            count(
              distinct dispensing_point_id
            )::int
              as location_count

          from lot_balances

          where balance > 0
            and expiration_date
              >= (now() at time zone 'America/Bogota')::date

          group by commercial_code

          having sum(balance) > 0
        )

        select
          up.commercial_code,

          coalesce(
            nullif(tap.descripcion_generica, ''),
            up.commercial_code
          ) as molecule,

          tap.descripcion_comercial
            as commercial_description,

          up.usable_quantity,
          up.location_count

        from usable_products up

        left join tariff_annex_products tap
          on tap.codigo_producto = up.commercial_code

        order by
          up.usable_quantity desc,
          up.commercial_code
        `,
        scopeValues,
      );

    const authorizationRow =
      authorizations.rows[0] ?? {};

    const noveltySummaryRow =
      noveltySummary.rows[0] ?? {};

    const base = {
      generatedAt: new Date().toISOString(),

      authorizations: {
        total:
          asInt(authorizationRow.total),

        passedFirstFilter:
          asInt(
            authorizationRow.passed_first_filter,
          ),

        purchaseOrderIssued:
          asInt(
            authorizationRow.purchase_order_issued,
          ),

        supplierManaged:
          asInt(
            authorizationRow.supplier_managed,
          ),

        receivedAtPoint:
          asInt(
            authorizationRow.received_at_point,
          ),
      },

      coverage: {
        pbs:
          asInt(authorizationRow.pbs),

        noPbs:
          asInt(authorizationRow.no_pbs),
      },

      inventory: {
        availableMoleculeCount:
          inventory.rows.length,

        molecules:
          inventory.rows.map((row) => ({
            commercialCode:
              asText(row.commercial_code) ?? '',

            molecule:
              asText(row.molecule) ?? '',

            commercialDescription:
              asText(
                row.commercial_description,
              ),

            usableQuantity:
              asInt(row.usable_quantity),

            locationCount:
              asInt(row.location_count),
          })),
      },

      novelties: {
        affectedAuthorizationCount:
          asInt(
            noveltySummaryRow
              .affected_authorization_count,
          ),

        activeNoveltyCount:
          asInt(
            noveltySummaryRow
              .active_novelty_count,
          ),

        byCause:
          noveltyByCause.rows.map((row) => ({
            code:
              asText(row.code) ?? '',

            description:
              asText(row.description) ?? '',

            affectedAuthorizationCount:
              asInt(
                row.affected_authorization_count,
              ),

            noveltyCount:
              asInt(row.novelty_count),
          })),
      },
    };

    if (!input.includeEconomics) {
      return {
        ...base,
        purchaseOrders: null,
      };
    }

    const purchaseOrders =
      await this.database.pool.query<Record<string, unknown>>(
        `
        with managed_orders as (
          select distinct po.id

          from purchase_orders po

          where po.status in (
            'ACCEPTED',
            'PARTIALLY_ACCEPTED',
            'REJECTED',
            'IN_FULFILLMENT',
            'PARTIALLY_DISPATCHED',
            'FULLY_DISPATCHED',
            'PARTIALLY_RECEIVED',
            'RECEIVED'
          )

          and (
            $2::text = 'MTD'

            or exists (
              select 1

              from purchase_order_lines scoped_pol

              join purchase_order_authorization_sources scoped_poas
                on scoped_poas.purchase_order_line_id =
                   scoped_pol.id

              join authorization_item_organizations aio
                on aio.authorization_item_id =
                   scoped_poas.authorization_item_id

              where scoped_pol.purchase_order_id = po.id
                and aio.organization_id = $1::uuid
            )
          )
        ),

        per_order as (
          select
            po.id,

            coalesce(
              po.purchase_order_code,
              po.id::text
            ) as purchase_order_code,

            po.status,
            po.issued_at,
            po.created_at,

            coalesce(
              sum(
                coalesce(
                  pol.accepted_quantity,
                  0
                )::numeric
                *
                case
                  when pol.compensar_unit_rate_snapshot
                    ~ '^[0-9]+([.][0-9]+)?$'
                  then
                    pol.compensar_unit_rate_snapshot::numeric
                  else 0
                end
              ),
              0
            )::numeric(18,2)
              as contractual_value,

            coalesce(
              sum(
                coalesce(
                  pol.accepted_quantity,
                  0
                )::numeric
                *
                case
                  when coalesce(
                    pol.supplier_unit_cost,
                    ''
                  ) ~ '^[0-9]+([.][0-9]+)?$'
                  then
                    pol.supplier_unit_cost::numeric
                  else 0
                end
              ),
              0
            )::numeric(18,2)
              as supplier_expense

          from managed_orders mo

          join purchase_orders po
            on po.id = mo.id

          join purchase_order_lines pol
            on pol.purchase_order_id = po.id

          group by
            po.id,
            po.purchase_order_code,
            po.status,
            po.issued_at,
            po.created_at
        )

        select
          id,
          purchase_order_code,
          status,

          contractual_value::text
            as contractual_value,

          supplier_expense::text
            as supplier_expense,

          count(*) over()::int
            as managed_order_count,

          sum(contractual_value)
            over()::numeric(18,2)::text
            as total_contractual_value,

          sum(supplier_expense)
            over()::numeric(18,2)::text
            as total_supplier_expense

        from per_order

        order by
          issued_at desc nulls last,
          created_at desc
        `,
        scopeValues,
      );

    const firstOrder =
      purchaseOrders.rows[0];

    return {
      ...base,

      purchaseOrders: {
        managedOrderCount:
          firstOrder
            ? asInt(
                firstOrder.managed_order_count,
              )
            : 0,

        totalContractualValue:
          asMoney(
            firstOrder
              ?.total_contractual_value,
          ) ?? '0.00',

        totalSupplierExpense:
          asMoney(
            firstOrder
              ?.total_supplier_expense,
          ) ?? '0.00',

        items:
          purchaseOrders.rows.map((row) => ({
            id:
              asText(row.id) ?? '',

            purchaseOrderCode:
              asText(
                row.purchase_order_code,
              ) ?? '',

            status:
              asText(row.status) ?? '',

            contractualValue:
              asMoney(
                row.contractual_value,
              ) ?? '0.00',

            supplierExpense:
              asMoney(
                row.supplier_expense,
              ) ?? '0.00',
          })),
      },
    };
  }

  async novelties(query: AnalyticsQuery): Promise<NoveltyCount[]> {
    const schedulePeriod = query.planningPeriodId
      ? sql`(ps.planning_period_id = ${query.planningPeriodId} or ps.deferred_planning_period_id = ${query.planningPeriodId})`
      : sql`true`;
    const schedulePoint = query.dispensingPointId
      ? sql`ps.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const scheduleCode = query.commercialCode
      ? sql`ps.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const outcomeDate = this.dateRange(query, sql`pso.occurred_on`);
    const outcomeStatus = query.operationalStatus === 'APPLIED' ? sql`false` : sql`true`;
    const novelty = query.noveltyCode ? sql`pso.novelty_code = ${query.noveltyCode}` : sql`true`;
    const rows = await this.database.db.execute<{
      novelty_code: PatientOperationalNovelty;
      count: number;
    }>(sql`
      select pso.novelty_code, count(*)::int count
      from patient_schedule_outcomes pso
      join patient_schedules ps on ps.id = pso.patient_schedule_id
      where ${outcomeStatus} and ${novelty} and ${schedulePeriod} and ${schedulePoint}
        and ${scheduleCode} and ${outcomeDate}
      group by pso.novelty_code
    `);
    const counts = new Map(rows.rows.map((row) => [row.novelty_code, asInt(row.count)]));
    return NOVELTY_CODES.map((noveltyCode) => ({
      noveltyCode,
      count: counts.get(noveltyCode) ?? 0,
    }));
  }

  async lots(query: AnalyticsQuery) {
    const lotPoint = query.dispensingPointId
      ? sql`l.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const lotCode = query.commercialCode
      ? sql`l.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select l.id, l.commercial_code, l.dispensing_point_id, dp.code dispensing_point_code,
             dp.name dispensing_point_name, l.lot_number, l.expiration_date::text,
             coalesce(sum(m.quantity_delta), 0)::int physical_balance,
             case when l.expiration_date < current_date then 0 else coalesce(sum(m.quantity_delta), 0)::int end usable_balance,
             l.expiration_date < current_date expired,
             l.expiration_date >= current_date and l.expiration_date <= current_date + 30 upcoming_expiration
      from inventory_lots l
      join dispensing_points dp on dp.id = l.dispensing_point_id
      left join inventory_movements m on m.inventory_lot_id = l.id
      where ${lotPoint} and ${lotCode}
      group by l.id, dp.id
      order by l.commercial_code, l.expiration_date, l.lot_number
    `);
    return rows.rows.map((row) => ({
      inventoryLotId: asText(row.id) ?? '',
      commercialCode: asText(row.commercial_code) ?? '',
      dispensingPointId: asText(row.dispensing_point_id) ?? '',
      dispensingPointCode: asText(row.dispensing_point_code) ?? '',
      dispensingPointName: asText(row.dispensing_point_name) ?? '',
      lotNumber: asText(row.lot_number) ?? '',
      expirationDate: asText(row.expiration_date) ?? '',
      physicalBalance: asInt(row.physical_balance),
      usableBalance: Math.max(asInt(row.usable_balance), 0),
      expired: Boolean(row.expired),
      upcomingExpiration: Boolean(row.upcoming_expiration),
    }));
  }

  async drilldown(query: AnalyticsDrilldownQuery) {
    const limit = query.limit;
    switch (query.kind) {
      case 'projected':
        return this.projectedRows(query, limit);
      case 'ordered':
      case 'accepted':
        return this.purchaseRows(query, limit);
      case 'dispatched':
        return this.deliveryRows(query, limit);
      case 'received':
        return this.receiptRows(query, limit);
      case 'accepted_into_inventory':
        return this.acceptedReceiptRows(query, limit);
      case 'applied':
        return this.applicationRows(query, limit);
      case 'not_applied':
        return this.outcomeRows(query, limit);
      case 'audit':
        return this.auditRows(query, limit);
      default:
        return [];
    }
  }

  private dateRange(query: AnalyticsQuery, column: SQL) {
    const from = query.dateFrom ? sql`${column} >= ${query.dateFrom}` : sql`true`;
    const to = query.dateTo ? sql`${column} <= ${query.dateTo}` : sql`true`;
    return sql`${from} and ${to}`;
  }

  private async projectedRows(query: AnalyticsQuery, limit: number) {
    const demandPeriod = query.planningPeriodId
      ? sql`pdl.planning_period_id = ${query.planningPeriodId}`
      : sql`true`;
    const demandPoint = query.dispensingPointId
      ? sql`pdl.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const demandCode = query.commercialCode
      ? sql`pdl.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select pdl.id, pdl.commercial_code, pdl.dispensing_point_id, pdl.projected_quantity, pdl.status
      from projected_demand_lines pdl
      where ${demandPeriod} and ${demandPoint} and ${demandCode}
      order by pdl.commercial_code, pdl.id
      limit ${limit}
    `);
    return rows.rows.map((row) => this.item('projected', row, 'projected_quantity', 'status'));
  }

  private async purchaseRows(query: AnalyticsDrilldownQuery, limit: number) {
    const period = query.planningPeriodId
      ? sql`po.planning_period_id = ${query.planningPeriodId}`
      : sql`true`;
    const point = query.dispensingPointId
      ? sql`pol.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const code = query.commercialCode
      ? sql`pol.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const orderType = query.orderType ? sql`po.order_type = ${query.orderType}` : sql`true`;
    const bucket = query.demandBucket ? sql`pol.demand_bucket = ${query.demandBucket}` : sql`true`;
    const quantityColumn =
      query.kind === 'accepted' ? sql`pol.accepted_quantity` : sql`pol.requested_quantity`;
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select pol.id, pol.commercial_code, pol.dispensing_point_id, ${quantityColumn} quantity, po.status,
             po.purchase_order_code reference
      from purchase_order_lines pol
      join purchase_orders po on po.id = pol.purchase_order_id
      where po.status not in ('DRAFT', 'CANCELLED')
        and ${period} and ${point} and ${code} and ${orderType} and ${bucket}
      order by po.created_at desc, pol.id
      limit ${limit}
    `);
    return rows.rows.map((row) => this.item(query.kind, row, 'quantity', 'status', 'reference'));
  }

  private async deliveryRows(query: AnalyticsQuery, limit: number) {
    const period = query.planningPeriodId
      ? sql`po.planning_period_id = ${query.planningPeriodId}`
      : sql`true`;
    const point = query.dispensingPointId
      ? sql`dl.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const code = query.commercialCode
      ? sql`dl.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const orderType = query.orderType ? sql`po.order_type = ${query.orderType}` : sql`true`;
    const bucket = query.demandBucket ? sql`pol.demand_bucket = ${query.demandBucket}` : sql`true`;
    const deliveryDate = this.dateRange(query, sql`d.dispatched_at::date`);
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select dl.id, dl.commercial_code, dl.dispensing_point_id, dl.quantity, d.status, d.id::text reference
      from delivery_lines dl
      join deliveries d on d.id = dl.delivery_id
      join purchase_order_lines pol on pol.id = dl.purchase_order_line_id
      join purchase_orders po on po.id = pol.purchase_order_id
      where d.status in ('DISPATCHED', 'RECEIVED')
        and ${period} and ${point} and ${code} and ${orderType} and ${bucket} and ${deliveryDate}
      order by d.dispatched_at desc, dl.id
      limit ${limit}
    `);
    return rows.rows.map((row) => this.item('dispatched', row, 'quantity', 'status', 'reference'));
  }

  private async receiptRows(query: AnalyticsQuery, limit: number) {
    const period = query.planningPeriodId
      ? sql`po.planning_period_id = ${query.planningPeriodId}`
      : sql`true`;
    const point = query.dispensingPointId
      ? sql`pol.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const code = query.commercialCode
      ? sql`pol.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const orderType = query.orderType ? sql`po.order_type = ${query.orderType}` : sql`true`;
    const bucket = query.demandBucket ? sql`pol.demand_bucket = ${query.demandBucket}` : sql`true`;
    const receiptDate = this.dateRange(query, sql`r.received_at::date`);
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select rl.id, pol.commercial_code, pol.dispensing_point_id, rl.received_quantity quantity, r.status,
             r.id::text reference
      from receipt_lines rl
      join receipts r on r.id = rl.receipt_id
      join delivery_lines dl on dl.id = rl.delivery_line_id
      join purchase_order_lines pol on pol.id = dl.purchase_order_line_id
      join purchase_orders po on po.id = pol.purchase_order_id
      where r.status = 'CONFIRMED'
        and ${period} and ${point} and ${code} and ${orderType} and ${bucket} and ${receiptDate}
      order by r.received_at desc, rl.id
      limit ${limit}
    `);
    return rows.rows.map((row) => this.item('received', row, 'quantity', 'status', 'reference'));
  }

  private async acceptedReceiptRows(query: AnalyticsQuery, limit: number) {
    const period = query.planningPeriodId
      ? sql`po.planning_period_id = ${query.planningPeriodId}`
      : sql`true`;
    const point = query.dispensingPointId
      ? sql`pol.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const code = query.commercialCode
      ? sql`pol.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const orderType = query.orderType ? sql`po.order_type = ${query.orderType}` : sql`true`;
    const bucket = query.demandBucket ? sql`pol.demand_bucket = ${query.demandBucket}` : sql`true`;
    const receiptDate = this.dateRange(query, sql`r.received_at::date`);
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select rl.id, pol.commercial_code, pol.dispensing_point_id, rl.accepted_quantity quantity,
             r.status, r.id::text reference
      from receipt_lines rl
      join receipts r on r.id = rl.receipt_id
      join delivery_lines dl on dl.id = rl.delivery_line_id
      join purchase_order_lines pol on pol.id = dl.purchase_order_line_id
      join purchase_orders po on po.id = pol.purchase_order_id
      where r.status = 'CONFIRMED' and rl.accepted_quantity > 0
        and ${period} and ${point} and ${code} and ${orderType} and ${bucket} and ${receiptDate}
      order by r.received_at desc, rl.id
      limit ${limit}
    `);
    return rows.rows.map((row) =>
      this.item('accepted_into_inventory', row, 'quantity', 'status', 'reference'),
    );
  }

  private async applicationRows(query: AnalyticsQuery, limit: number) {
    const appPeriod = query.planningPeriodId
      ? sql`(ps.planning_period_id = ${query.planningPeriodId} or ps.deferred_planning_period_id = ${query.planningPeriodId})`
      : sql`true`;
    const appPoint = query.dispensingPointId
      ? sql`pa.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const appCode = query.commercialCode
      ? sql`pa.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const applicationDate = this.dateRange(query, sql`pa.application_date`);
    const applicationStatus = query.operationalStatus === 'NOT_APPLIED' ? sql`false` : sql`true`;
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select pa.id, pa.commercial_code, pa.dispensing_point_id, coalesce(sum(pal.quantity), 0)::int quantity,
             pa.status, pa.id::text reference
      from patient_applications pa
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      join patient_application_lines pal on pal.patient_application_id = pa.id
      where pa.status = 'CONFIRMED' and ${applicationStatus}
        and ${appPeriod} and ${appPoint} and ${appCode} and ${applicationDate}
      group by pa.id
      order by pa.application_date desc, pa.id
      limit ${limit}
    `);
    return rows.rows.map((row) => this.item('applied', row, 'quantity', 'status', 'reference'));
  }

  private async outcomeRows(query: AnalyticsQuery, limit: number) {
    const schedulePeriod = query.planningPeriodId
      ? sql`(ps.planning_period_id = ${query.planningPeriodId} or ps.deferred_planning_period_id = ${query.planningPeriodId})`
      : sql`true`;
    const schedulePoint = query.dispensingPointId
      ? sql`ps.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const scheduleCode = query.commercialCode
      ? sql`ps.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const outcomeDate = this.dateRange(query, sql`pso.occurred_on`);
    const outcomeStatus = query.operationalStatus === 'APPLIED' ? sql`false` : sql`true`;
    const novelty = query.noveltyCode ? sql`pso.novelty_code = ${query.noveltyCode}` : sql`true`;
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select pso.id, ps.commercial_code, ps.dispensing_point_id, ps.quantity, pso.novelty_code status,
             pso.id::text reference
      from patient_schedule_outcomes pso
      join patient_schedules ps on ps.id = pso.patient_schedule_id
      where ${outcomeStatus} and ${novelty} and ${schedulePeriod} and ${schedulePoint}
        and ${scheduleCode} and ${outcomeDate}
      order by pso.occurred_on desc, pso.id
      limit ${limit}
    `);
    return rows.rows.map((row) => this.item('not_applied', row, 'quantity', 'status', 'reference'));
  }

  private async auditRows(query: AnalyticsQuery, limit: number) {
    const appPeriod = query.planningPeriodId
      ? sql`(ps.planning_period_id = ${query.planningPeriodId} or ps.deferred_planning_period_id = ${query.planningPeriodId})`
      : sql`true`;
    const appPoint = query.dispensingPointId
      ? sql`pa.dispensing_point_id = ${query.dispensingPointId}`
      : sql`true`;
    const appCode = query.commercialCode
      ? sql`pa.commercial_code = ${query.commercialCode}`
      : sql`true`;
    const applicationDate = this.dateRange(query, sql`pa.application_date`);
    const auditStatus =
      query.auditStatus === 'READY_FOR_AUDIT'
        ? sql`paa.id is null`
        : query.auditStatus
          ? sql`paa.status = ${query.auditStatus}`
          : sql`true`;
    const rows = await this.database.db.execute<Record<string, unknown>>(sql`
      select coalesce(paa.id, pa.id) id, pa.commercial_code, pa.dispensing_point_id,
             coalesce((select sum(pal.quantity) from patient_application_lines pal where pal.patient_application_id = pa.id), 0)::int quantity,
             coalesce(paa.status, 'READY_FOR_AUDIT') status, pa.id::text reference
      from patient_applications pa
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      left join patient_application_audits paa on paa.patient_application_id = pa.id
      where pa.status = 'CONFIRMED'
        and not exists (
          select 1 from patient_schedule_outcomes pso
          where pso.patient_schedule_id = pa.patient_schedule_id
            and pso.schedule_revision = pa.schedule_revision
        )
        and ${appPeriod} and ${appPoint} and ${appCode} and ${applicationDate} and ${auditStatus}
      order by pa.application_date desc, pa.id
      limit ${limit}
    `);
    return rows.rows.map((row) => this.item('audit', row, 'quantity', 'status', 'reference'));
  }

  private item(
    kind: AnalyticsDrilldownKind,
    row: Record<string, unknown>,
    quantityKey: string,
    statusKey: string,
    referenceKey?: string,
  ) {
    return {
      id: asText(row.id) ?? '',
      kind,
      commercialCode: asText(row.commercial_code),
      dispensingPointId: asText(row.dispensing_point_id),
      quantity: row[quantityKey] == null ? null : asInt(row[quantityKey]),
      status: asText(row[statusKey]),
      reference: referenceKey ? asText(row[referenceKey]) : null,
    };
  }
}
