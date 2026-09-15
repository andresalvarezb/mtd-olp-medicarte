import { RECONCILIATION_RULE_BY_CODE } from '@authorization/domain';
import type { ReconciliationRuleDefinition } from '@authorization/domain';
import {
  type DetectedFinding,
  type ExecutableRule,
  type RuleContext,
  type RuleEvaluation,
  SqlParams,
  phiSafeEvidence,
  scopeSql,
} from './reconciliation.types';

type FindingSqlRow = {
  entity_type: string;
  entity_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  dispensing_point_id: string | null;
  planning_period_id: string | null;
  commercial_code: string | null;
  message: string;
  evidence: Record<string, unknown> | string | null;
};

const empty = (evaluatedCount = 0): RuleEvaluation => ({
  evaluatedCount,
  findings: [],
  totalDetected: 0,
});

function definition(code: string): ReconciliationRuleDefinition {
  const rule = RECONCILIATION_RULE_BY_CODE[code];
  if (!rule) throw new Error(`Unknown reconciliation rule ${code}`);
  return rule;
}

function mapFinding(row: FindingSqlRow): DetectedFinding {
  const evidence =
    typeof row.evidence === 'string'
      ? (JSON.parse(row.evidence) as Record<string, unknown>)
      : (row.evidence ?? {});
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    dispensingPointId: row.dispensing_point_id,
    planningPeriodId: row.planning_period_id,
    commercialCode: row.commercial_code,
    message: row.message,
    evidence: phiSafeEvidence(evidence),
  };
}

async function count(ctx: RuleContext, sql: string, values: unknown[]): Promise<number> {
  const result = await ctx.query<{ n: number | string }>(sql, values);
  return Number(result.rows[0]?.n ?? 0);
}

async function detect(
  ctx: RuleContext,
  applicabilitySql: string,
  applicabilityValues: unknown[],
  violationSql: string,
  violationValues: unknown[],
): Promise<RuleEvaluation> {
  const evaluatedCount = await count(
    ctx,
    `select count(*)::int as n from (${applicabilitySql}) q`,
    applicabilityValues,
  );
  if (evaluatedCount === 0) return empty();
  const totalDetected = await count(
    ctx,
    `select count(*)::int as n from (${violationSql}) q`,
    violationValues,
  );
  if (totalDetected === 0) return empty(evaluatedCount);
  const limited = await ctx.query<FindingSqlRow>(
    `${violationSql} limit ${ctx.maxFindings}`,
    violationValues,
  );
  return { evaluatedCount, findings: limited.rows.map(mapFinding), totalDetected };
}

function mtd(code: string, run: (ctx: RuleContext) => Promise<RuleEvaluation>): ExecutableRule {
  return {
    definition: definition(code),
    evaluate: async (ctx) => {
      if (!ctx.operationalTenant) return empty();
      return run(ctx);
    },
  };
}

function observationPass(
  code: string,
  applicability: (ctx: RuleContext) => { sql: string; values: unknown[] },
): ExecutableRule {
  return mtd(code, async (ctx) => {
    const { sql, values } = applicability(ctx);
    const evaluatedCount = await count(ctx, `select count(*)::int as n from (${sql}) q`, values);
    return empty(evaluatedCount);
  });
}

export const RECONCILIATION_RULE_IMPLEMENTATIONS: readonly ExecutableRule[] = [
  mtd('REC-SCH-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'ps.dispensing_point_id',
      code: 'ps.commercial_code',
    });
    const applicable = `select ps.id from patient_schedules ps where ps.status in ('SCHEDULED','RESCHEDULED') and ${scoped}`;
    const violations = `
      select 'patient_schedule'::varchar as entity_type,
             (array_agg(ps.id))[1] as entity_id,
             null::varchar as related_entity_type,
             null::uuid as related_entity_id,
             ps.dispensing_point_id,
             (array_agg(ps.planning_period_id))[1] as planning_period_id,
             (array_agg(ps.commercial_code))[1] as commercial_code,
             'Duplicate active schedule identity'::varchar as message,
             json_build_object(
               'authorizationItemId', ps.authorization_item_id,
               'dispensingPointId', ps.dispensing_point_id,
               'scheduledDate', ps.scheduled_date,
               'activeCount', count(*)
             ) as evidence
        from patient_schedules ps
       where ps.status in ('SCHEDULED','RESCHEDULED') and ${scoped}
       group by ps.authorization_item_id, ps.dispensing_point_id, ps.scheduled_date
      having count(*) > 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-SCH-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'ps.dispensing_point_id',
      code: 'ps.commercial_code',
    });
    const applicable = `
      select ps.id from patient_schedules ps
       where exists (select 1 from patient_schedule_history h where h.patient_schedule_id = ps.id)
         and ${scoped}`;
    const violations = `
      select 'patient_schedule'::varchar as entity_type, ps.id as entity_id,
             'patient_schedule_history'::varchar as related_entity_type, null::uuid as related_entity_id,
             ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code,
             'Schedule revision does not match reconstructable history'::varchar as message,
             json_build_object(
               'patientScheduleId', ps.id,
               'currentRevision', ps.revision,
               'historyMaxRevision', mx.max_revision,
               'historyRowMatches', (h.id is not null)
             ) as evidence
        from patient_schedules ps
        join lateral (
          select max(h.revision) as max_revision
            from patient_schedule_history h
           where h.patient_schedule_id = ps.id
        ) mx on true
        left join patient_schedule_history h
          on h.patient_schedule_id = ps.id
         and h.revision = ps.revision
         and h.quantity = ps.quantity
         and h.status = ps.status
         and h.scheduled_date = ps.scheduled_date
         and h.dispensing_point_id = ps.dispensing_point_id
         and h.planning_period_id = ps.planning_period_id
       where exists (select 1 from patient_schedule_history hx where hx.patient_schedule_id = ps.id)
         and ${scoped}
         and (ps.revision is distinct from mx.max_revision or h.id is null)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-SCH-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'ps.dispensing_point_id',
      code: 'ps.commercial_code',
    });
    const applicable = `select ps.id from patient_schedules ps where ps.late_handling = 'NEXT_PERIOD' and ${scoped}`;
    const violations = `
      select 'patient_schedule'::varchar as entity_type, ps.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code,
             'NEXT_PERIOD schedule is missing deferred_planning_period_id'::varchar as message,
             json_build_object('patientScheduleId', ps.id, 'lateHandling', ps.late_handling) as evidence
        from patient_schedules ps
       where ps.late_handling = 'NEXT_PERIOD'
         and ps.deferred_planning_period_id is null
         and ${scoped}`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-SCH-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'ps.dispensing_point_id',
      code: 'ps.commercial_code',
    });
    const applicable = `
      select ps.id from patient_schedules ps
       where ps.late_handling = 'NEXT_PERIOD' and ps.deferred_planning_period_id is not null and ${scoped}`;
    const violations = `
      select 'patient_schedule'::varchar as entity_type, ps.id as entity_id,
             'planning_period'::varchar as related_entity_type, ps.deferred_planning_period_id as related_entity_id,
             ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code,
             'Deferred planning period is missing or not after the original period'::varchar as message,
             json_build_object(
               'patientScheduleId', ps.id,
               'planningPeriodId', ps.planning_period_id,
               'deferredPlanningPeriodId', ps.deferred_planning_period_id
             ) as evidence
        from patient_schedules ps
        join planning_periods original on original.id = ps.planning_period_id
        left join planning_periods deferred on deferred.id = ps.deferred_planning_period_id
       where ps.late_handling = 'NEXT_PERIOD'
         and ps.deferred_planning_period_id is not null
         and ${scoped}
         and (deferred.id is null or deferred.start_date <= original.end_date)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEM-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'pdl.planning_period_id',
      point: 'pdl.dispensing_point_id',
      code: 'pdl.commercial_code',
    });
    const applicable = `select pdl.id from projected_demand_lines pdl where ${scoped}`;
    const violations = `
      select 'projected_demand_line'::varchar as entity_type, pdl.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             pdl.dispensing_point_id, pdl.planning_period_id, pdl.commercial_code,
             'projected_quantity is not regular_quantity + late_quantity'::varchar as message,
             json_build_object(
               'projectedDemandLineId', pdl.id,
               'projectedQuantity', pdl.projected_quantity,
               'regularQuantity', pdl.regular_quantity,
               'lateQuantity', pdl.late_quantity
             ) as evidence
        from projected_demand_lines pdl
       where ${scoped}
         and pdl.projected_quantity <> pdl.regular_quantity + pdl.late_quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEM-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'pdl.planning_period_id',
      point: 'pdl.dispensing_point_id',
      code: 'pdl.commercial_code',
    });
    const applicable = `
      select pdl.id from projected_demand_lines pdl
       where exists (select 1 from demand_sources ds where ds.projected_demand_line_id = pdl.id)
         and ${scoped}`;
    const violations = `
      select 'projected_demand_line'::varchar as entity_type, pdl.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             pdl.dispensing_point_id, pdl.planning_period_id, pdl.commercial_code,
             'demand_sources sums do not match the materialized line'::varchar as message,
             json_build_object(
               'projectedDemandLineId', pdl.id,
               'expectedRegular', pdl.regular_quantity,
               'actualRegular', coalesce(s.regular_sum, 0),
               'expectedLate', pdl.late_quantity,
               'actualLate', coalesce(s.late_sum, 0)
             ) as evidence
        from projected_demand_lines pdl
        left join lateral (
          select coalesce(sum(ds.quantity) filter (where ds.demand_bucket = 'REGULAR'), 0)::int as regular_sum,
                 coalesce(sum(ds.quantity) filter (where ds.demand_bucket = 'LATE'), 0)::int as late_sum
            from demand_sources ds
           where ds.projected_demand_line_id = pdl.id
        ) s on true
       where exists (select 1 from demand_sources ds where ds.projected_demand_line_id = pdl.id)
         and ${scoped}
         and (coalesce(s.regular_sum, 0) <> pdl.regular_quantity or coalesce(s.late_sum, 0) <> pdl.late_quantity)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEM-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'pdl.planning_period_id',
      point: 'pdl.dispensing_point_id',
      code: 'pdl.commercial_code',
    });
    const applicable = `
      select ds.id from demand_sources ds
      join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
      where ${scoped}`;
    const violations = `
      select 'demand_source'::varchar as entity_type, ds.id as entity_id,
             'patient_schedule'::varchar as related_entity_type, ds.patient_schedule_id as related_entity_id,
             pdl.dispensing_point_id, pdl.planning_period_id, pdl.commercial_code,
             'demand_source period/bucket does not follow ESP-004 rules'::varchar as message,
             json_build_object(
               'demandSourceId', ds.id,
               'scheduleTiming', ds.schedule_timing,
               'lateHandling', ds.late_handling,
               'demandBucket', ds.demand_bucket,
               'planningPeriodId', ds.planning_period_id,
               'expectedBucket', expected.bucket,
               'expectedPeriodId', expected.period_id
             ) as evidence
        from demand_sources ds
        join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
        join patient_schedule_history h
          on h.patient_schedule_id = ds.patient_schedule_id and h.revision = ds.schedule_revision
        cross join lateral (
          select case
                   when ds.schedule_timing = 'ON_TIME' then 'REGULAR'
                   when ds.late_handling = 'COMPLEMENTARY_PURCHASE_ORDER' then 'LATE'
                   when ds.late_handling = 'NEXT_PERIOD' then 'REGULAR'
                   else null
                 end as bucket,
                 case
                   when ds.schedule_timing = 'ON_TIME' then h.planning_period_id
                   when ds.late_handling = 'COMPLEMENTARY_PURCHASE_ORDER' then h.planning_period_id
                   when ds.late_handling = 'NEXT_PERIOD' then h.deferred_planning_period_id
                   else null
                 end as period_id
        ) expected
       where ${scoped}
         and (ds.demand_bucket is distinct from expected.bucket
              or ds.planning_period_id is distinct from expected.period_id)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEM-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'pdl.planning_period_id',
      point: 'pdl.dispensing_point_id',
      code: 'pdl.commercial_code',
    });
    const applicable = `select pdl.id from projected_demand_lines pdl where ${scoped}`;
    const violations = `
      select 'projected_demand_line'::varchar as entity_type, pdl.id as entity_id,
             'patient_schedule'::varchar as related_entity_type, stale.patient_schedule_id as related_entity_id,
             pdl.dispensing_point_id, pdl.planning_period_id, pdl.commercial_code,
             'Projected demand is stale relative to current schedules'::varchar as message,
             json_build_object(
               'projectedDemandLineId', pdl.id,
               'consolidatedAt', pdl.consolidated_at,
               'staleReason', stale.reason,
               'corruption', false
             ) as evidence
        from projected_demand_lines pdl
        join lateral (
          select ps.id as patient_schedule_id, 'ACTIVE_SCHEDULE_NOT_IN_SOURCES'::varchar as reason
            from patient_schedules ps
           where ps.status in ('SCHEDULED','RESCHEDULED')
             and ps.dispensing_point_id = pdl.dispensing_point_id
             and ps.commercial_code = pdl.commercial_code
             and (
               (ps.schedule_timing = 'ON_TIME' and ps.planning_period_id = pdl.planning_period_id)
               or (ps.late_handling = 'COMPLEMENTARY_PURCHASE_ORDER' and ps.planning_period_id = pdl.planning_period_id)
               or (ps.late_handling = 'NEXT_PERIOD' and ps.deferred_planning_period_id = pdl.planning_period_id)
             )
             and not exists (
               select 1 from demand_sources ds
                where ds.projected_demand_line_id = pdl.id
                  and ds.patient_schedule_id = ps.id
                  and ds.schedule_revision = ps.revision
             )
           union all
          select ds.patient_schedule_id, 'SOURCE_REVISION_OR_STATUS_DRIFT'::varchar
            from demand_sources ds
            join patient_schedules ps on ps.id = ds.patient_schedule_id
           where ds.projected_demand_line_id = pdl.id
             and (ps.revision <> ds.schedule_revision or ps.status = 'CANCELLED')
           limit 1
        ) stale on true
       where ${scoped}`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-PO-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'po.planning_period_id',
      point: 'pol.dispensing_point_id',
      code: 'pol.commercial_code',
    });
    const applicable = `
      select pol.id from purchase_order_lines pol
      join purchase_orders po on po.id = pol.purchase_order_id
      where ${scoped}`;
    const violations = `
      select 'purchase_order_line'::varchar as entity_type, pol.id as entity_id,
             'purchase_order'::varchar as related_entity_type, po.id as related_entity_id,
             pol.dispensing_point_id, po.planning_period_id, pol.commercial_code,
             'requested_quantity is not positive'::varchar as message,
             json_build_object('purchaseOrderLineId', pol.id, 'requestedQuantity', pol.requested_quantity) as evidence
        from purchase_order_lines pol
        join purchase_orders po on po.id = pol.purchase_order_id
       where ${scoped} and pol.requested_quantity <= 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-PO-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'po.planning_period_id',
      point: 'pol.dispensing_point_id',
      code: 'pol.commercial_code',
    });
    const applicable = `
      select pol.id from purchase_order_lines pol
      join purchase_orders po on po.id = pol.purchase_order_id
      where pol.accepted_quantity is not null and ${scoped}`;
    const violations = `
      select 'purchase_order_line'::varchar as entity_type, pol.id as entity_id,
             'purchase_order'::varchar as related_entity_type, po.id as related_entity_id,
             pol.dispensing_point_id, po.planning_period_id, pol.commercial_code,
             'accepted_quantity is negative or greater than requested_quantity'::varchar as message,
             json_build_object(
               'purchaseOrderLineId', pol.id,
               'acceptedQuantity', pol.accepted_quantity,
               'requestedQuantity', pol.requested_quantity
             ) as evidence
        from purchase_order_lines pol
        join purchase_orders po on po.id = pol.purchase_order_id
       where pol.accepted_quantity is not null
         and ${scoped}
         and (pol.accepted_quantity < 0 or pol.accepted_quantity > pol.requested_quantity)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-PO-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'po.planning_period_id',
      point: 'pol.dispensing_point_id',
      code: 'pol.commercial_code',
    });
    const applicable = `
      select a.purchase_order_line_id from purchase_order_demand_allocations a
      join purchase_order_lines pol on pol.id = a.purchase_order_line_id
      join purchase_orders po on po.id = pol.purchase_order_id
      where ${scoped}`;
    const violations = `
      select 'purchase_order_demand_allocation'::varchar as entity_type, a.purchase_order_line_id as entity_id,
             'purchase_order_line'::varchar as related_entity_type, a.purchase_order_line_id as related_entity_id,
             pol.dispensing_point_id, po.planning_period_id, pol.commercial_code,
             'allocation quantity is not positive'::varchar as message,
             json_build_object('purchaseOrderLineId', a.purchase_order_line_id, 'allocatedQuantity', a.allocated_quantity) as evidence
        from purchase_order_demand_allocations a
        join purchase_order_lines pol on pol.id = a.purchase_order_line_id
        join purchase_orders po on po.id = pol.purchase_order_id
       where ${scoped} and a.allocated_quantity <= 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-PO-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'po.planning_period_id',
      point: 'pol.dispensing_point_id',
      code: 'pol.commercial_code',
    });
    const applicable = `
      select a.purchase_order_line_id from purchase_order_demand_allocations a
      join purchase_order_lines pol on pol.id = a.purchase_order_line_id
      join purchase_orders po on po.id = pol.purchase_order_id
      where ${scoped}`;
    const violations = `
      select 'purchase_order_demand_allocation'::varchar as entity_type, a.purchase_order_line_id as entity_id,
             'purchase_order'::varchar as related_entity_type, po.id as related_entity_id,
             pol.dispensing_point_id, po.planning_period_id, pol.commercial_code,
             'allocation demand bucket is incompatible with purchase order type'::varchar as message,
             json_build_object('purchaseOrderId', po.id, 'orderType', po.order_type, 'demandBucket', a.demand_bucket) as evidence
        from purchase_order_demand_allocations a
        join purchase_order_lines pol on pol.id = a.purchase_order_line_id
        join purchase_orders po on po.id = pol.purchase_order_id
       where ${scoped}
         and (
           (po.order_type = 'STANDARD' and a.demand_bucket <> 'REGULAR')
           or (po.order_type = 'COMPLEMENTARY' and a.demand_bucket <> 'LATE')
         )`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-PO-006', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'po.planning_period_id',
      point: 'pol.dispensing_point_id',
      code: 'pol.commercial_code',
    });
    const applicable = `
      select pol.id from purchase_order_lines pol
      join purchase_orders po on po.id = pol.purchase_order_id
      where ${scoped}`;
    const violations = `
      select 'purchase_order_line'::varchar as entity_type, pol.id as entity_id,
             'projected_demand_line'::varchar as related_entity_type, pol.projected_demand_line_id as related_entity_id,
             pol.dispensing_point_id, po.planning_period_id, pol.commercial_code,
             'purchase order line references a missing projected demand line'::varchar as message,
             json_build_object(
               'purchaseOrderLineId', pol.id,
               'projectedDemandLineId', pol.projected_demand_line_id,
               'projectedDemandRevision', pol.projected_demand_revision
             ) as evidence
        from purchase_order_lines pol
        join purchase_orders po on po.id = pol.purchase_order_id
        left join projected_demand_lines pdl on pdl.id = pol.projected_demand_line_id
       where ${scoped} and pdl.id is null`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEL-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'po.planning_period_id',
      point: 'pol.dispensing_point_id',
      code: 'pol.commercial_code',
    });
    const applicable = `
      select pol.id from purchase_order_lines pol
      join purchase_orders po on po.id = pol.purchase_order_id
      where pol.accepted_quantity is not null and ${scoped}`;
    const violations = `
      select 'purchase_order_line'::varchar as entity_type, pol.id as entity_id,
             'delivery'::varchar as related_entity_type, null::uuid as related_entity_id,
             pol.dispensing_point_id, po.planning_period_id, pol.commercial_code,
             'Dispatched quantity exceeds accepted quantity'::varchar as message,
             json_build_object(
               'purchaseOrderLineId', pol.id,
               'dispatchedSum', dispatched.qty,
               'acceptedQuantity', pol.accepted_quantity
             ) as evidence
        from purchase_order_lines pol
        join purchase_orders po on po.id = pol.purchase_order_id
        join lateral (
          select coalesce(sum(dl.quantity), 0)::int as qty
            from delivery_lines dl
            join deliveries d on d.id = dl.delivery_id
           where dl.purchase_order_line_id = pol.id
             and d.status in ('DISPATCHED','RECEIVED')
        ) dispatched on true
       where pol.accepted_quantity is not null
         and ${scoped}
         and dispatched.qty > pol.accepted_quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEL-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { period: 'po.planning_period_id' });
    const applicable = `
      select d.id from deliveries d
      join purchase_orders po on po.id = d.purchase_order_id
      where d.status in ('DISPATCHED','RECEIVED') and ${scoped}`;
    const violations = `
      select 'delivery'::varchar as entity_type, d.id as entity_id,
             'purchase_order'::varchar as related_entity_type, d.purchase_order_id as related_entity_id,
             null::uuid as dispensing_point_id, po.planning_period_id, null::varchar as commercial_code,
             'Dispatched delivery has no lines'::varchar as message,
             json_build_object('deliveryId', d.id, 'status', d.status, 'lineCount', 0) as evidence
        from deliveries d
        join purchase_orders po on po.id = d.purchase_order_id
       where d.status in ('DISPATCHED','RECEIVED')
         and ${scoped}
         and not exists (select 1 from delivery_lines dl where dl.delivery_id = d.id)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEL-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'dl.dispensing_point_id',
      code: 'dl.commercial_code',
    });
    const applicable = `select dl.id from delivery_lines dl where ${scoped}`;
    const violations = `
      select 'delivery_line'::varchar as entity_type, dl.id as entity_id,
             'delivery'::varchar as related_entity_type, dl.delivery_id as related_entity_id,
             dl.dispensing_point_id, null::uuid as planning_period_id, dl.commercial_code,
             'delivery line quantity is not positive'::varchar as message,
             json_build_object('deliveryLineId', dl.id, 'quantity', dl.quantity) as evidence
        from delivery_lines dl
       where ${scoped} and dl.quantity <= 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-DEL-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'dl.dispensing_point_id',
      code: 'dl.commercial_code',
    });
    const applicable = `select dl.id from delivery_lines dl where ${scoped}`;
    const violations = `
      select 'delivery_line'::varchar as entity_type, dl.id as entity_id,
             'purchase_order_line'::varchar as related_entity_type, dl.purchase_order_line_id as related_entity_id,
             dl.dispensing_point_id, null::uuid as planning_period_id, dl.commercial_code,
             'delivery line product or point does not match the purchase order line'::varchar as message,
             json_build_object(
               'deliveryLineId', dl.id,
               'purchaseOrderLineId', pol.id,
               'deliveryCode', dl.commercial_code,
               'poCode', pol.commercial_code,
               'deliveryPointId', dl.dispensing_point_id,
               'poPointId', pol.dispensing_point_id
             ) as evidence
        from delivery_lines dl
        join purchase_order_lines pol on pol.id = dl.purchase_order_line_id
       where ${scoped}
         and (dl.commercial_code is distinct from pol.commercial_code
              or dl.dispensing_point_id is distinct from pol.dispensing_point_id)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-RCP-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'dl.dispensing_point_id',
      code: 'dl.commercial_code',
    });
    const applicable = `
      select rl.id from receipt_lines rl
      join receipts r on r.id = rl.receipt_id
      join delivery_lines dl on dl.id = rl.delivery_line_id
      where r.status = 'CONFIRMED' and ${scoped}`;
    const violations = `
      select 'receipt_line'::varchar as entity_type, rl.id as entity_id,
             'receipt'::varchar as related_entity_type, r.id as related_entity_id,
             dl.dispensing_point_id, null::uuid as planning_period_id, dl.commercial_code,
             'accepted + rejected does not equal received'::varchar as message,
             json_build_object(
               'receiptLineId', rl.id,
               'acceptedQuantity', rl.accepted_quantity,
               'rejectedQuantity', rl.rejected_quantity,
               'receivedQuantity', rl.received_quantity
             ) as evidence
        from receipt_lines rl
        join receipts r on r.id = rl.receipt_id
        join delivery_lines dl on dl.id = rl.delivery_line_id
       where r.status = 'CONFIRMED' and ${scoped}
         and rl.accepted_quantity + rl.rejected_quantity <> rl.received_quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-RCP-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'dl.dispensing_point_id',
      code: 'dl.commercial_code',
    });
    const applicable = `
      select rl.id from receipt_lines rl
      join delivery_lines dl on dl.id = rl.delivery_line_id
      where ${scoped}`;
    const violations = `
      select 'receipt_line'::varchar as entity_type, rl.id as entity_id,
             'receipt'::varchar as related_entity_type, rl.receipt_id as related_entity_id,
             dl.dispensing_point_id, null::uuid as planning_period_id, dl.commercial_code,
             'shortage_quantity does not equal dispatched - received'::varchar as message,
             json_build_object(
               'receiptLineId', rl.id,
               'shortageQuantity', rl.shortage_quantity,
               'dispatchedQuantity', rl.dispatched_quantity,
               'receivedQuantity', rl.received_quantity
             ) as evidence
        from receipt_lines rl
        join delivery_lines dl on dl.id = rl.delivery_line_id
       where ${scoped}
         and rl.shortage_quantity <> rl.dispatched_quantity - rl.received_quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-RCP-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'dl.dispensing_point_id',
      code: 'dl.commercial_code',
    });
    const applicable = `
      select rl.id from receipt_lines rl
      join delivery_lines dl on dl.id = rl.delivery_line_id
      where ${scoped}`;
    const violations = `
      select 'receipt_line'::varchar as entity_type, rl.id as entity_id,
             'receipt'::varchar as related_entity_type, rl.receipt_id as related_entity_id,
             dl.dispensing_point_id, null::uuid as planning_period_id, dl.commercial_code,
             'received_quantity exceeds dispatched_quantity'::varchar as message,
             json_build_object(
               'receiptLineId', rl.id,
               'receivedQuantity', rl.received_quantity,
               'dispatchedQuantity', rl.dispatched_quantity
             ) as evidence
        from receipt_lines rl
        join delivery_lines dl on dl.id = rl.delivery_line_id
       where ${scoped} and rl.received_quantity > rl.dispatched_quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-RCP-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'dl.dispensing_point_id',
      code: 'dl.commercial_code',
    });
    const applicable = `
      select rl.id from receipt_lines rl
      join delivery_lines dl on dl.id = rl.delivery_line_id
      where rl.accepted_quantity > 0 and ${scoped}`;
    const violations = `
      select 'receipt_line'::varchar as entity_type, rl.id as entity_id,
             'receipt'::varchar as related_entity_type, rl.receipt_id as related_entity_id,
             dl.dispensing_point_id, null::uuid as planning_period_id, dl.commercial_code,
             'accepted quantity is missing observed lot or expiration'::varchar as message,
             json_build_object(
               'receiptLineId', rl.id,
               'acceptedQuantity', rl.accepted_quantity,
               'hasLot', rl.received_lot_number is not null,
               'hasExpiration', rl.received_expiration_date is not null
             ) as evidence
        from receipt_lines rl
        join delivery_lines dl on dl.id = rl.delivery_line_id
       where rl.accepted_quantity > 0 and ${scoped}
         and (rl.received_lot_number is null or btrim(rl.received_lot_number) = ''
              or rl.received_expiration_date is null)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-INV-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'dl.dispensing_point_id',
      code: 'dl.commercial_code',
    });
    const applicable = `
      select rl.id from receipt_lines rl
      join receipts r on r.id = rl.receipt_id
      join delivery_lines dl on dl.id = rl.delivery_line_id
      where r.status = 'CONFIRMED' and rl.accepted_quantity > 0 and ${scoped}`;
    const violations = `
      select 'receipt_line'::varchar as entity_type, rl.id as entity_id,
             'inventory_movement'::varchar as related_entity_type, null::uuid as related_entity_id,
             dl.dispensing_point_id, null::uuid as planning_period_id, dl.commercial_code,
             'CONFIRMED accepted receipt line does not have exactly one matching RECEIPT movement'::varchar as message,
             json_build_object(
               'receiptLineId', rl.id,
               'expectedMovementCount', 1,
               'actualMovementCount', coalesce(m.movement_count, 0),
               'expectedDelta', rl.accepted_quantity,
               'actualDelta', m.quantity_delta
             ) as evidence
        from receipt_lines rl
        join receipts r on r.id = rl.receipt_id
        join delivery_lines dl on dl.id = rl.delivery_line_id
        left join lateral (
          select count(*)::int as movement_count, max(im.quantity_delta) as quantity_delta
            from inventory_movements im
           where im.movement_type = 'RECEIPT'
             and im.source_type = 'RECEIPT_LINE'
             and im.source_id = rl.id
        ) m on true
       where r.status = 'CONFIRMED' and rl.accepted_quantity > 0 and ${scoped}
         and (coalesce(m.movement_count, 0) <> 1
              or coalesce(m.quantity_delta, 0) <> rl.accepted_quantity)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-INV-002', async (ctx) => {
    const params = new SqlParams();
    const applicable = `select m.id from inventory_movements m where m.movement_type = 'RECEIPT'`;
    const violations = `
      select 'inventory_movement'::varchar as entity_type, m.id as entity_id,
             'inventory_lot'::varchar as related_entity_type, m.inventory_lot_id as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'RECEIPT movement is not positive'::varchar as message,
             json_build_object('inventoryMovementId', m.id, 'quantityDelta', m.quantity_delta) as evidence
        from inventory_movements m
        join inventory_lots lot on lot.id = m.inventory_lot_id
       where m.movement_type = 'RECEIPT' and m.quantity_delta <= 0
         and ${scopeSql(params, ctx.scope, { point: 'lot.dispensing_point_id', code: 'lot.commercial_code' })}`;
    return detect(ctx, applicable, [], violations, params.values);
  }),
  mtd('REC-INV-003', async (ctx) => {
    const params = new SqlParams();
    const applicable = `select m.id from inventory_movements m where m.movement_type = 'APPLICATION'`;
    const violations = `
      select 'inventory_movement'::varchar as entity_type, m.id as entity_id,
             'inventory_lot'::varchar as related_entity_type, m.inventory_lot_id as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'APPLICATION movement is not negative'::varchar as message,
             json_build_object('inventoryMovementId', m.id, 'quantityDelta', m.quantity_delta) as evidence
        from inventory_movements m
        join inventory_lots lot on lot.id = m.inventory_lot_id
       where m.movement_type = 'APPLICATION' and m.quantity_delta >= 0
         and ${scopeSql(params, ctx.scope, { point: 'lot.dispensing_point_id', code: 'lot.commercial_code' })}`;
    return detect(ctx, applicable, [], violations, params.values);
  }),
  mtd('REC-INV-004', async (ctx) => {
    const params = new SqlParams();
    const applicable = `select m.id from inventory_movements m where m.movement_type = 'TRANSFER_OUT'`;
    const violations = `
      select 'inventory_movement'::varchar as entity_type, m.id as entity_id,
             'inventory_lot'::varchar as related_entity_type, m.inventory_lot_id as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'TRANSFER_OUT movement is not negative'::varchar as message,
             json_build_object('inventoryMovementId', m.id, 'quantityDelta', m.quantity_delta) as evidence
        from inventory_movements m
        join inventory_lots lot on lot.id = m.inventory_lot_id
       where m.movement_type = 'TRANSFER_OUT' and m.quantity_delta >= 0
         and ${scopeSql(params, ctx.scope, { point: 'lot.dispensing_point_id', code: 'lot.commercial_code' })}`;
    return detect(ctx, applicable, [], violations, params.values);
  }),
  mtd('REC-INV-005', async (ctx) => {
    const params = new SqlParams();
    const applicable = `select m.id from inventory_movements m where m.movement_type = 'TRANSFER_IN'`;
    const violations = `
      select 'inventory_movement'::varchar as entity_type, m.id as entity_id,
             'inventory_lot'::varchar as related_entity_type, m.inventory_lot_id as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'TRANSFER_IN movement is not positive'::varchar as message,
             json_build_object('inventoryMovementId', m.id, 'quantityDelta', m.quantity_delta) as evidence
        from inventory_movements m
        join inventory_lots lot on lot.id = m.inventory_lot_id
       where m.movement_type = 'TRANSFER_IN' and m.quantity_delta <= 0
         and ${scopeSql(params, ctx.scope, { point: 'lot.dispensing_point_id', code: 'lot.commercial_code' })}`;
    return detect(ctx, applicable, [], violations, params.values);
  }),
  mtd('REC-INV-006', async (ctx) => {
    const params = new SqlParams();
    const applicable = `select m.id from inventory_movements m where m.movement_type = 'NON_REUSABLE'`;
    const violations = `
      select 'inventory_movement'::varchar as entity_type, m.id as entity_id,
             'inventory_lot'::varchar as related_entity_type, m.inventory_lot_id as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'NON_REUSABLE movement is not negative'::varchar as message,
             json_build_object('inventoryMovementId', m.id, 'quantityDelta', m.quantity_delta) as evidence
        from inventory_movements m
        join inventory_lots lot on lot.id = m.inventory_lot_id
       where m.movement_type = 'NON_REUSABLE' and m.quantity_delta >= 0
         and ${scopeSql(params, ctx.scope, { point: 'lot.dispensing_point_id', code: 'lot.commercial_code' })}`;
    return detect(ctx, applicable, [], violations, params.values);
  }),
  mtd('REC-INV-007', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'lot.dispensing_point_id',
      code: 'lot.commercial_code',
    });
    const applicable = `select lot.id from inventory_lots lot where ${scoped}`;
    const violations = `
      select 'inventory_lot'::varchar as entity_type, (array_agg(lot.id))[1] as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'Duplicate inventory lot identity'::varchar as message,
             json_build_object(
               'commercialCode', lot.commercial_code,
               'dispensingPointId', lot.dispensing_point_id,
               'lotNumber', lot.lot_number,
               'expirationDate', lot.expiration_date,
               'lotCount', count(*)
             ) as evidence
        from inventory_lots lot
       where ${scoped}
       group by lot.commercial_code, lot.dispensing_point_id, lot.lot_number, lot.expiration_date
      having count(*) > 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-INV-008', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'lot.dispensing_point_id',
      code: 'lot.commercial_code',
    });
    const applicable = `select lot.id from inventory_lots lot where ${scoped}`;
    const violations = `
      select 'inventory_lot'::varchar as entity_type, lot.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'Derived physical balance is negative'::varchar as message,
             json_build_object('inventoryLotId', lot.id, 'physicalBalance', bal.physical_balance) as evidence
        from inventory_lots lot
        join lateral (
          select coalesce(sum(m.quantity_delta), 0)::int as physical_balance
            from inventory_movements m
           where m.inventory_lot_id = lot.id
        ) bal on true
       where ${scoped} and bal.physical_balance < 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-INV-009', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 'lot.dispensing_point_id',
      code: 'lot.commercial_code',
    });
    const applicable = `
      select lot.id from inventory_lots lot
      where lot.expiration_date < current_date and ${scoped}`;
    const violations = `
      select 'inventory_lot'::varchar as entity_type, lot.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             lot.dispensing_point_id, null::uuid as planning_period_id, lot.commercial_code,
             'Expired physical inventory with usableBalance 0'::varchar as message,
             json_build_object(
               'inventoryLotId', lot.id,
               'physicalBalance', bal.physical_balance,
               'expirationDate', lot.expiration_date,
               'usableBalance', 0
             ) as evidence
        from inventory_lots lot
        join lateral (
          select coalesce(sum(m.quantity_delta), 0)::int as physical_balance
            from inventory_movements m
           where m.inventory_lot_id = lot.id
        ) bal on true
       where lot.expiration_date < current_date and ${scoped} and bal.physical_balance > 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-TRF-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 't.source_dispensing_point_id',
      code: 'tl.commercial_code',
    });
    const applicable = `
      select tl.id from stock_transfer_lines tl
      join stock_transfers t on t.id = tl.stock_transfer_id
      where t.status in ('DISPATCHED','RECEIVED') and ${scoped}`;
    const violations = `
      select 'stock_transfer_line'::varchar as entity_type, tl.id as entity_id,
             'stock_transfer'::varchar as related_entity_type, t.id as related_entity_id,
             t.source_dispensing_point_id as dispensing_point_id, null::uuid as planning_period_id, tl.commercial_code,
             'Dispatched or received transfer line does not have exactly one TRANSFER_OUT'::varchar as message,
             json_build_object('stockTransferLineId', tl.id, 'status', t.status, 'transferOutCount', coalesce(m.cnt, 0)) as evidence
        from stock_transfer_lines tl
        join stock_transfers t on t.id = tl.stock_transfer_id
        left join lateral (
          select count(*)::int as cnt
            from inventory_movements im
           where im.movement_type = 'TRANSFER_OUT' and im.source_type = 'TRANSFER_LINE' and im.source_id = tl.id
        ) m on true
       where t.status in ('DISPATCHED','RECEIVED') and ${scoped} and coalesce(m.cnt, 0) <> 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-TRF-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 't.destination_dispensing_point_id',
      code: 'tl.commercial_code',
    });
    const applicable = `
      select tl.id from stock_transfer_lines tl
      join stock_transfers t on t.id = tl.stock_transfer_id
      where t.status = 'RECEIVED' and ${scoped}`;
    const violations = `
      select 'stock_transfer_line'::varchar as entity_type, tl.id as entity_id,
             'stock_transfer'::varchar as related_entity_type, t.id as related_entity_id,
             t.destination_dispensing_point_id as dispensing_point_id, null::uuid as planning_period_id, tl.commercial_code,
             'Received transfer line does not have exactly one TRANSFER_IN'::varchar as message,
             json_build_object('stockTransferLineId', tl.id, 'transferInCount', coalesce(m.cnt, 0)) as evidence
        from stock_transfer_lines tl
        join stock_transfers t on t.id = tl.stock_transfer_id
        left join lateral (
          select count(*)::int as cnt
            from inventory_movements im
           where im.movement_type = 'TRANSFER_IN' and im.source_type = 'TRANSFER_LINE' and im.source_id = tl.id
        ) m on true
       where t.status = 'RECEIVED' and ${scoped} and coalesce(m.cnt, 0) <> 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-TRF-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 't.source_dispensing_point_id' });
    const applicable = `select t.id from stock_transfers t where t.status = 'DISPATCHED' and ${scoped}`;
    const violations = `
      select 'stock_transfer'::varchar as entity_type, t.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             t.source_dispensing_point_id as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'DISPATCHED transfer has TRANSFER_IN before receive'::varchar as message,
             json_build_object('stockTransferId', t.id, 'transferInCount', ins.cnt) as evidence
        from stock_transfers t
        join lateral (
          select count(*)::int as cnt
            from stock_transfer_lines tl
            join inventory_movements im
              on im.movement_type = 'TRANSFER_IN' and im.source_type = 'TRANSFER_LINE' and im.source_id = tl.id
           where tl.stock_transfer_id = t.id
        ) ins on true
       where t.status = 'DISPATCHED' and ${scoped} and ins.cnt > 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-TRF-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 't.source_dispensing_point_id' });
    const applicable = `select t.id from stock_transfers t where ${scoped}`;
    const violations = `
      select 'stock_transfer'::varchar as entity_type, t.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             t.source_dispensing_point_id as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'Transfer source and destination points are the same'::varchar as message,
             json_build_object(
               'stockTransferId', t.id,
               'sourceDispensingPointId', t.source_dispensing_point_id,
               'destinationDispensingPointId', t.destination_dispensing_point_id
             ) as evidence
        from stock_transfers t
       where ${scoped} and t.source_dispensing_point_id = t.destination_dispensing_point_id`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-TRF-005', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      point: 't.destination_dispensing_point_id',
      code: 'tl.commercial_code',
    });
    const applicable = `
      select tl.id from stock_transfer_lines tl
      join stock_transfers t on t.id = tl.stock_transfer_id
      where t.status = 'RECEIVED' and ${scoped}`;
    const violations = `
      select 'stock_transfer_line'::varchar as entity_type, tl.id as entity_id,
             'stock_transfer'::varchar as related_entity_type, t.id as related_entity_id,
             t.destination_dispensing_point_id as dispensing_point_id, null::uuid as planning_period_id, tl.commercial_code,
             'TRANSFER_OUT and TRANSFER_IN quantities are not conserved'::varchar as message,
             json_build_object(
               'stockTransferLineId', tl.id,
               'outDelta', m.out_delta,
               'inDelta', m.in_delta,
               'lineQuantity', tl.quantity
             ) as evidence
        from stock_transfer_lines tl
        join stock_transfers t on t.id = tl.stock_transfer_id
        left join lateral (
          select
            (select im.quantity_delta from inventory_movements im
              where im.movement_type = 'TRANSFER_OUT' and im.source_type = 'TRANSFER_LINE' and im.source_id = tl.id
              limit 1) as out_delta,
            (select im.quantity_delta from inventory_movements im
              where im.movement_type = 'TRANSFER_IN' and im.source_type = 'TRANSFER_LINE' and im.source_id = tl.id
              limit 1) as in_delta
        ) m on true
       where t.status = 'RECEIVED' and ${scoped}
         and (m.out_delta is null or m.in_delta is null
              or abs(m.out_delta) <> m.in_delta
              or m.in_delta <> tl.quantity)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  observationPass('REC-TRF-006', (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 't.source_dispensing_point_id' });
    return {
      sql: `select t.id from stock_transfers t where t.status = 'DISPATCHED' and ${scoped}`,
      values: params.values,
    };
  }),
];
