import { RECONCILIATION_RULE_BY_CODE } from '@authorization/domain';
import type { ReconciliationRuleDefinition } from '@authorization/domain';
import type { ExecutableRule, RuleContext, RuleEvaluation } from './reconciliation.types';
import { SqlParams, phiSafeEvidence, scopeSql } from './reconciliation.types';

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

function mapFinding(row: FindingSqlRow) {
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

function mtdStructural(
  code: string,
  run: (ctx: RuleContext) => Promise<RuleEvaluation>,
): ExecutableRule {
  return {
    definition: definition(code),
    evaluate: async (ctx) => {
      if (!ctx.operationalTenant) return empty();
      if (ctx.scope.planningPeriodId || ctx.scope.commercialCode) return empty();
      return run(ctx);
    },
  };
}

function always(
  code: string,
  run: (ctx: RuleContext) => RuleEvaluation | Promise<RuleEvaluation>,
): ExecutableRule {
  return {
    definition: definition(code),
    evaluate: async (ctx) => {
      if (ctx.scope.planningPeriodId || ctx.scope.commercialCode) return empty();
      return run(ctx);
    },
  };
}

function observationPass(
  code: string,
  applicability: (ctx: RuleContext) => { sql: string; values: unknown[] },
  tenantSensitive = true,
): ExecutableRule {
  return {
    definition: definition(code),
    evaluate: async (ctx) => {
      if (tenantSensitive && !ctx.operationalTenant) return empty();
      const { sql, values } = applicability(ctx);
      const evaluatedCount = await count(ctx, `select count(*)::int as n from (${sql}) q`, values);
      return empty(evaluatedCount);
    },
  };
}

export const RECONCILIATION_RULE_IMPLEMENTATIONS_REST: readonly ExecutableRule[] = [
  mtd('REC-APP-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select pa.id from patient_applications pa
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where pa.status = 'CONFIRMED' and ${scoped}`;
    const violations = `
      select 'patient_application'::varchar as entity_type, pa.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'CONFIRMED application has no lines'::varchar as message,
             json_build_object('patientApplicationId', pa.id, 'lineCount', 0) as evidence
        from patient_applications pa
        join patient_schedules ps on ps.id = pa.patient_schedule_id
       where pa.status = 'CONFIRMED' and ${scoped}
         and not exists (select 1 from patient_application_lines l where l.patient_application_id = pa.id)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-APP-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select pa.id from patient_applications pa
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where pa.status = 'CONFIRMED' and ${scoped}`;
    const violations = `
      select 'patient_application'::varchar as entity_type, pa.id as entity_id,
             'patient_schedule'::varchar as related_entity_type, pa.patient_schedule_id as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'Applied quantity does not match the confirmed schedule revision'::varchar as message,
             json_build_object(
               'patientApplicationId', pa.id,
               'appliedSum', coalesce(lines.qty, 0),
               'scheduleQuantity', h.quantity,
               'scheduleRevision', pa.schedule_revision
             ) as evidence
        from patient_applications pa
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join patient_schedule_history h
          on h.patient_schedule_id = pa.patient_schedule_id and h.revision = pa.schedule_revision
        left join lateral (
          select coalesce(sum(l.quantity), 0)::int as qty
            from patient_application_lines l
           where l.patient_application_id = pa.id
        ) lines on true
       where pa.status = 'CONFIRMED' and ${scoped}
         and coalesce(lines.qty, 0) <> h.quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-APP-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'l.dispensing_point_id',
      code: 'l.commercial_code',
    });
    const applicable = `
      select l.id from patient_application_lines l
      join patient_applications pa on pa.id = l.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where pa.status = 'CONFIRMED' and ${scoped}`;
    const violations = `
      select 'patient_application_line'::varchar as entity_type, l.id as entity_id,
             'patient_application'::varchar as related_entity_type, pa.id as related_entity_id,
             l.dispensing_point_id, ps.planning_period_id, l.commercial_code,
             'CONFIRMED application line does not have exactly one APPLICATION movement'::varchar as message,
             json_build_object(
               'applicationLineId', l.id,
               'expectedMovementCount', 1,
               'actualMovementCount', coalesce(m.cnt, 0)
             ) as evidence
        from patient_application_lines l
        join patient_applications pa on pa.id = l.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        left join lateral (
          select count(*)::int as cnt
            from inventory_movements im
           where im.movement_type = 'APPLICATION'
             and im.source_type = 'APPLICATION_LINE'
             and im.source_id = l.id
        ) m on true
       where pa.status = 'CONFIRMED' and ${scoped} and coalesce(m.cnt, 0) <> 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-APP-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'l.dispensing_point_id',
      code: 'l.commercial_code',
    });
    const applicable = `
      select l.id from patient_application_lines l
      join patient_applications pa on pa.id = l.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where pa.status = 'CONFIRMED' and ${scoped}`;
    const violations = `
      select 'patient_application_line'::varchar as entity_type, l.id as entity_id,
             'inventory_movement'::varchar as related_entity_type, m.id as related_entity_id,
             l.dispensing_point_id, ps.planning_period_id, l.commercial_code,
             'APPLICATION movement quantity does not match the application line'::varchar as message,
             json_build_object(
               'applicationLineId', l.id,
               'lineQuantity', l.quantity,
               'quantityDelta', m.quantity_delta
             ) as evidence
        from patient_application_lines l
        join patient_applications pa on pa.id = l.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join inventory_movements m
          on m.movement_type = 'APPLICATION' and m.source_type = 'APPLICATION_LINE' and m.source_id = l.id
       where pa.status = 'CONFIRMED' and ${scoped} and abs(m.quantity_delta) <> l.quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-APP-005', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'l.dispensing_point_id',
      code: 'l.commercial_code',
    });
    const applicable = `
      select l.id from patient_application_lines l
      join patient_applications pa on pa.id = l.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where ${scoped}`;
    const violations = `
      select 'patient_application_line'::varchar as entity_type, l.id as entity_id,
             'patient_application'::varchar as related_entity_type, pa.id as related_entity_id,
             l.dispensing_point_id, ps.planning_period_id, l.commercial_code,
             'Application line lot is incompatible with the application schedule'::varchar as message,
             json_build_object(
               'applicationLineId', l.id,
               'lineCode', l.commercial_code,
               'applicationCode', pa.commercial_code,
               'lotCode', lot.commercial_code,
               'linePointId', l.dispensing_point_id,
               'applicationPointId', pa.dispensing_point_id
             ) as evidence
        from patient_application_lines l
        join patient_applications pa on pa.id = l.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join inventory_lots lot on lot.id = l.inventory_lot_id
       where ${scoped}
         and (l.commercial_code is distinct from pa.commercial_code
              or l.dispensing_point_id is distinct from pa.dispensing_point_id
              or lot.commercial_code is distinct from l.commercial_code
              or lot.dispensing_point_id is distinct from l.dispensing_point_id)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-APP-006', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select pa.id from patient_applications pa
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where pa.status = 'CONFIRMED' and ${scoped}`;
    const violations = `
      select 'patient_application'::varchar as entity_type, pa.id as entity_id,
             'patient_schedule_outcome'::varchar as related_entity_type, o.id as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'CONFIRMED application and NOT_APPLIED outcome coexist for the same revision'::varchar as message,
             json_build_object(
               'patientScheduleId', pa.patient_schedule_id,
               'scheduleRevision', pa.schedule_revision,
               'patientApplicationId', pa.id,
               'outcomeId', o.id
             ) as evidence
        from patient_applications pa
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join patient_schedule_outcomes o
          on o.patient_schedule_id = pa.patient_schedule_id
         and o.schedule_revision = pa.schedule_revision
       where pa.status = 'CONFIRMED' and ${scoped}`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-OUT-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'ps.dispensing_point_id',
      code: 'ps.commercial_code',
    });
    const applicable = `
      select o.id from patient_schedule_outcomes o
      join patient_schedules ps on ps.id = o.patient_schedule_id
      where ${scoped}`;
    const violations = `
      select 'patient_schedule'::varchar as entity_type, o.patient_schedule_id as entity_id,
             'patient_schedule_outcome'::varchar as related_entity_type, (array_agg(o.id))[1] as related_entity_id,
             ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code,
             'More than one NOT_APPLIED outcome for the same schedule revision'::varchar as message,
             json_build_object(
               'patientScheduleId', o.patient_schedule_id,
               'scheduleRevision', o.schedule_revision,
               'outcomeCount', count(*)
             ) as evidence
        from patient_schedule_outcomes o
        join patient_schedules ps on ps.id = o.patient_schedule_id
       where ${scoped}
       group by o.patient_schedule_id, o.schedule_revision, ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code
      having count(*) > 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-OUT-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'l.dispensing_point_id',
      code: 'l.commercial_code',
    });
    const applicable = `
      select l.id from patient_schedule_outcome_lines l
      join patient_schedule_outcomes o on o.id = l.outcome_id
      join patient_schedules ps on ps.id = o.patient_schedule_id
      where o.prepared_product_disposition = 'NON_REUSABLE' and ${scoped}`;
    const violations = `
      select 'patient_schedule_outcome_line'::varchar as entity_type, l.id as entity_id,
             'patient_schedule_outcome'::varchar as related_entity_type, o.id as related_entity_id,
             l.dispensing_point_id, ps.planning_period_id, l.commercial_code,
             'NON_REUSABLE outcome line does not have exactly one NON_REUSABLE movement'::varchar as message,
             json_build_object('outcomeLineId', l.id, 'movementCount', coalesce(m.cnt, 0)) as evidence
        from patient_schedule_outcome_lines l
        join patient_schedule_outcomes o on o.id = l.outcome_id
        join patient_schedules ps on ps.id = o.patient_schedule_id
        left join lateral (
          select count(*)::int as cnt
            from inventory_movements im
           where im.movement_type = 'NON_REUSABLE' and im.source_type = 'OUTCOME_LINE' and im.source_id = l.id
        ) m on true
       where o.prepared_product_disposition = 'NON_REUSABLE' and ${scoped}
         and coalesce(m.cnt, 0) <> 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-OUT-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'l.dispensing_point_id',
      code: 'l.commercial_code',
    });
    const applicable = `
      select l.id from patient_schedule_outcome_lines l
      join patient_schedule_outcomes o on o.id = l.outcome_id
      join patient_schedules ps on ps.id = o.patient_schedule_id
      where o.prepared_product_disposition = 'NON_REUSABLE' and ${scoped}`;
    const violations = `
      select 'patient_schedule_outcome_line'::varchar as entity_type, l.id as entity_id,
             'inventory_movement'::varchar as related_entity_type, m.id as related_entity_id,
             l.dispensing_point_id, ps.planning_period_id, l.commercial_code,
             'NON_REUSABLE movement quantity does not match the outcome line'::varchar as message,
             json_build_object('outcomeLineId', l.id, 'lineQuantity', l.quantity, 'quantityDelta', m.quantity_delta) as evidence
        from patient_schedule_outcome_lines l
        join patient_schedule_outcomes o on o.id = l.outcome_id
        join patient_schedules ps on ps.id = o.patient_schedule_id
        join inventory_movements m
          on m.movement_type = 'NON_REUSABLE' and m.source_type = 'OUTCOME_LINE' and m.source_id = l.id
       where o.prepared_product_disposition = 'NON_REUSABLE' and ${scoped}
         and abs(m.quantity_delta) <> l.quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-OUT-005', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'ps.dispensing_point_id',
      code: 'ps.commercial_code',
    });
    const applicable = `
      select o.id from patient_schedule_outcomes o
      join patient_schedules ps on ps.id = o.patient_schedule_id
      where o.prepared_product_disposition in ('REUSABLE','NOT_PREPARED') and ${scoped}`;
    const violations = `
      select 'patient_schedule_outcome'::varchar as entity_type, o.id as entity_id,
             'inventory_movement'::varchar as related_entity_type, null::uuid as related_entity_id,
             ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code,
             'REUSABLE or NOT_PREPARED outcome has an associated stock movement'::varchar as message,
             json_build_object(
               'outcomeId', o.id,
               'preparedProductDisposition', o.prepared_product_disposition,
               'movementCount', m.cnt
             ) as evidence
        from patient_schedule_outcomes o
        join patient_schedules ps on ps.id = o.patient_schedule_id
        join lateral (
          select count(*)::int as cnt
            from patient_schedule_outcome_lines l
            join inventory_movements im on im.source_id = l.id
           where l.outcome_id = o.id
        ) m on true
       where o.prepared_product_disposition in ('REUSABLE','NOT_PREPARED') and ${scoped} and m.cnt > 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-OUT-006', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'ps.dispensing_point_id',
      code: 'ps.commercial_code',
    });
    const applicable = `
      select o.id from patient_schedule_outcomes o
      join patient_schedules ps on ps.id = o.patient_schedule_id
      where o.prepared_product_disposition = 'NON_REUSABLE' and ${scoped}`;
    const violations = `
      select 'patient_schedule_outcome'::varchar as entity_type, o.id as entity_id,
             'patient_schedule'::varchar as related_entity_type, o.patient_schedule_id as related_entity_id,
             ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code,
             'NON_REUSABLE quantity exceeds the schedule quantity'::varchar as message,
             json_build_object(
               'outcomeId', o.id,
               'nonReusableSum', coalesce(lines.qty, 0),
               'scheduleQuantity', h.quantity
             ) as evidence
        from patient_schedule_outcomes o
        join patient_schedules ps on ps.id = o.patient_schedule_id
        join patient_schedule_history h
          on h.patient_schedule_id = o.patient_schedule_id and h.revision = o.schedule_revision
        left join lateral (
          select coalesce(sum(l.quantity), 0)::int as qty
            from patient_schedule_outcome_lines l
           where l.outcome_id = o.id
        ) lines on true
       where o.prepared_product_disposition = 'NON_REUSABLE' and ${scoped}
         and coalesce(lines.qty, 0) > h.quantity`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-AUD-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select a.id from patient_application_audits a
      join patient_applications pa on pa.id = a.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where a.status = 'APPROVED' and ${scoped}`;
    const violations = `
      select 'patient_application_audit'::varchar as entity_type, a.id as entity_id,
             'authorization_item'::varchar as related_entity_type, a.authorization_item_id as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'APPROVED audit does not have admission_status READY'::varchar as message,
             json_build_object('patientApplicationAuditId', a.id, 'admissionStatus', ai.admission_status) as evidence
        from patient_application_audits a
        join patient_applications pa on pa.id = a.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join authorization_items ai on ai.id = a.authorization_item_id
       where a.status = 'APPROVED' and ${scoped} and ai.admission_status is distinct from 'READY'`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-AUD-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select ai.id from authorization_items ai
      where ai.admission_status = 'READY'
        and exists (
          select 1 from patient_applications pa
          join patient_schedules ps on ps.id = pa.patient_schedule_id
          where pa.authorization_item_id = ai.id and ${scoped}
        )`;
    const violations = `
      select 'authorization_item'::varchar as entity_type, ai.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             null::uuid as dispensing_point_id, null::uuid as planning_period_id, ai.codigo_medicamento as commercial_code,
             'READY admission has no modern APPROVED application audit'::varchar as message,
             json_build_object('authorizationItemId', ai.id, 'approvedAuditCount', coalesce(a.cnt, 0)) as evidence
        from authorization_items ai
        left join lateral (
          select count(*)::int as cnt
            from patient_application_audits paa
            join patient_applications pa on pa.id = paa.patient_application_id
           where paa.authorization_item_id = ai.id
             and paa.status = 'APPROVED'
             and pa.status = 'CONFIRMED'
        ) a on true
       where ai.admission_status = 'READY'
         and exists (
           select 1 from patient_applications pa
           join patient_schedules ps on ps.id = pa.patient_schedule_id
           where pa.authorization_item_id = ai.id and ${scoped}
         )
         and coalesce(a.cnt, 0) = 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-AUD-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select a.id from patient_application_audits a
      join patient_applications pa on pa.id = a.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where a.status = 'REJECTED' and ${scoped}`;
    const violations = `
      select 'patient_application_audit'::varchar as entity_type, a.id as entity_id,
             'authorization_item'::varchar as related_entity_type, a.authorization_item_id as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'REJECTED audit is linked to READY admission without another APPROVED audit'::varchar as message,
             json_build_object(
               'patientApplicationAuditId', a.id,
               'authorizationItemId', a.authorization_item_id,
               'admissionStatus', ai.admission_status
             ) as evidence
        from patient_application_audits a
        join patient_applications pa on pa.id = a.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join authorization_items ai on ai.id = a.authorization_item_id
       where a.status = 'REJECTED'
         and ${scoped}
         and ai.admission_status = 'READY'
         and not exists (
           select 1 from patient_application_audits other
            where other.authorization_item_id = a.authorization_item_id
              and other.status = 'APPROVED'
              and other.id <> a.id
         )`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-AUD-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select a.id from patient_application_audits a
      join patient_applications pa on pa.id = a.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where ${scoped}`;
    const violations = `
      select 'patient_application_audit'::varchar as entity_type, a.id as entity_id,
             'patient_application'::varchar as related_entity_type, a.patient_application_id as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'Audit exists for a patient application that is not CONFIRMED'::varchar as message,
             json_build_object(
               'patientApplicationAuditId', a.id,
               'patientApplicationId', pa.id,
               'applicationStatus', pa.status
             ) as evidence
        from patient_application_audits a
        join patient_applications pa on pa.id = a.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
       where ${scoped} and pa.status is distinct from 'CONFIRMED'`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtd('REC-AUD-005', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select a.id from patient_application_audits a
      join patient_applications pa on pa.id = a.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where ${scoped}`;
    const violations = `
      select 'patient_application'::varchar as entity_type, a.patient_application_id as entity_id,
             'patient_application_audit'::varchar as related_entity_type, (array_agg(a.id))[1] as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'More than one audit exists for the same application'::varchar as message,
             json_build_object('patientApplicationId', a.patient_application_id, 'auditCount', count(*)) as evidence
        from patient_application_audits a
        join patient_applications pa on pa.id = a.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
       where ${scoped}
       group by a.patient_application_id, pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code
      having count(*) > 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-BULK-001', async (ctx) => {
    const params = new SqlParams();
    const tenant = ctx.operationalTenant
      ? 'TRUE'
      : `j.organization_id = ${params.add(ctx.tenantId)}`;
    const applicable = `
      select r.id from bulk_import_rows r
      join bulk_import_jobs j on j.id = r.job_id
      where r.execution_status = 'SUCCEEDED' and ${tenant}`;
    const violations = `
      select 'bulk_import_row'::varchar as entity_type, r.id as entity_id,
             'bulk_import_job'::varchar as related_entity_type, r.job_id as related_entity_id,
             null::uuid as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'SUCCEEDED bulk row is missing entity_reference'::varchar as message,
             json_build_object('bulkImportRowId', r.id, 'jobId', r.job_id) as evidence
        from bulk_import_rows r
        join bulk_import_jobs j on j.id = r.job_id
       where r.execution_status = 'SUCCEEDED' and ${tenant} and r.entity_reference is null`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-BULK-002', async (ctx) => {
    const params = new SqlParams();
    const tenant = ctx.operationalTenant
      ? 'TRUE'
      : `j.organization_id = ${params.add(ctx.tenantId)}`;
    const applicable = `
      select r.id from bulk_import_rows r
      join bulk_import_jobs j on j.id = r.job_id
      where r.execution_status = 'SUCCEEDED' and r.entity_reference is not null and ${tenant}`;
    const violations = `
      select 'bulk_import_row'::varchar as entity_type, r.id as entity_id,
             'patient_schedule'::varchar as related_entity_type, r.entity_reference as related_entity_id,
             null::uuid as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'SUCCEEDED scheduling row entity_reference does not point to an existing schedule'::varchar as message,
             json_build_object('bulkImportRowId', r.id, 'entityReference', r.entity_reference) as evidence
        from bulk_import_rows r
        join bulk_import_jobs j on j.id = r.job_id
        left join patient_schedules ps on ps.id = r.entity_reference
       where r.execution_status = 'SUCCEEDED' and r.entity_reference is not null and ${tenant} and ps.id is null`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-BULK-003', async (ctx) => {
    const params = new SqlParams();
    const tenant = ctx.operationalTenant
      ? 'TRUE'
      : `j.organization_id = ${params.add(ctx.tenantId)}`;
    const applicable = `
      select r.id from bulk_import_rows r
      join bulk_import_jobs j on j.id = r.job_id
      where r.execution_status = 'SUCCEEDED' and r.entity_reference is not null
        and r.normalized_payload is not null and ${tenant}`;
    const violations = `
      select 'bulk_import_row'::varchar as entity_type, r.id as entity_id,
             'patient_schedule'::varchar as related_entity_type, ps.id as related_entity_id,
             ps.dispensing_point_id, ps.planning_period_id, ps.commercial_code,
             'SUCCEEDED row does not match its normalized scheduling payload'::varchar as message,
             json_build_object(
               'bulkImportRowId', r.id,
               'patientScheduleId', ps.id,
               'mismatchedFields', mismatch.fields
             ) as evidence
        from bulk_import_rows r
        join bulk_import_jobs j on j.id = r.job_id
        join patient_schedules ps on ps.id = r.entity_reference
        join dispensing_points dp on dp.id = ps.dispensing_point_id
        cross join lateral (
          select array_remove(array[
            case when r.normalized_payload->>'commercialCode' is distinct from ps.commercial_code then 'commercialCode' end,
            case when (r.normalized_payload->>'scheduledDate')::date is distinct from ps.scheduled_date then 'scheduledDate' end,
            case when (r.normalized_payload->>'quantity')::int is distinct from ps.quantity then 'quantity' end,
            case when upper(r.normalized_payload->>'dispensingPointCode') is distinct from upper(dp.code) then 'dispensingPointCode' end
          ], null) as fields
        ) mismatch
       where r.execution_status = 'SUCCEEDED' and r.normalized_payload is not null and ${tenant}
         and cardinality(mismatch.fields) > 0`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-BULK-004', async (ctx) => {
    const params = new SqlParams();
    const tenant = ctx.operationalTenant
      ? 'TRUE'
      : `j.organization_id = ${params.add(ctx.tenantId)}`;
    const applicable = `
      select r.id from bulk_import_rows r
      join bulk_import_jobs j on j.id = r.job_id
      where r.execution_status = 'PROCESSING' and ${tenant}`;
    const violations = `
      select 'bulk_import_row'::varchar as entity_type, r.id as entity_id,
             'bulk_import_job'::varchar as related_entity_type, r.job_id as related_entity_id,
             null::uuid as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'PROCESSING row has an expired claim lease'::varchar as message,
             json_build_object(
               'bulkImportRowId', r.id,
               'claimExpiresAt', r.claim_expires_at,
               'staleClaim', true,
               'recoverable', true
             ) as evidence
        from bulk_import_rows r
        join bulk_import_jobs j on j.id = r.job_id
       where r.execution_status = 'PROCESSING' and ${tenant}
         and r.claim_expires_at is not null and r.claim_expires_at < now()`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-BULK-005', async (ctx) => {
    const params = new SqlParams();
    const tenant = ctx.operationalTenant
      ? 'TRUE'
      : `j.organization_id = ${params.add(ctx.tenantId)}`;
    const applicable = `select j.id from bulk_import_jobs j where j.status = 'COMPLETED' and ${tenant}`;
    const violations = `
      select 'bulk_import_job'::varchar as entity_type, j.id as entity_id,
             'bulk_import_row'::varchar as related_entity_type, r.id as related_entity_id,
             null::uuid as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'COMPLETED job has a row that is not SUCCEEDED or SKIPPED'::varchar as message,
             json_build_object('bulkImportJobId', j.id, 'offendingRowId', r.id, 'executionStatus', r.execution_status) as evidence
        from bulk_import_jobs j
        join bulk_import_rows r on r.job_id = j.id
       where j.status = 'COMPLETED' and ${tenant}
         and r.execution_status not in ('SUCCEEDED','SKIPPED')`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-BULK-006', async (ctx) => {
    const params = new SqlParams();
    const tenant = ctx.operationalTenant
      ? 'TRUE'
      : `j.organization_id = ${params.add(ctx.tenantId)}`;
    const applicable = `select j.id from bulk_import_jobs j where j.status = 'PARTIALLY_COMPLETED' and ${tenant}`;
    const violations = `
      select 'bulk_import_job'::varchar as entity_type, j.id as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             null::uuid as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'PARTIALLY_COMPLETED job does not have a compatible mix of results'::varchar as message,
             json_build_object(
               'bulkImportJobId', j.id,
               'succeededRows', coalesce(s.succeeded, 0),
               'failedRows', coalesce(s.failed, 0)
             ) as evidence
        from bulk_import_jobs j
        left join lateral (
          select count(*) filter (where r.execution_status = 'SUCCEEDED')::int as succeeded,
                 count(*) filter (where r.execution_status = 'FAILED')::int as failed
            from bulk_import_rows r
           where r.job_id = j.id
        ) s on true
       where j.status = 'PARTIALLY_COMPLETED' and ${tenant}
         and not (coalesce(s.succeeded, 0) > 0 and coalesce(s.failed, 0) > 0)`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-BULK-007', async (ctx) => {
    const params = new SqlParams();
    const tenant = ctx.operationalTenant
      ? 'TRUE'
      : `j.organization_id = ${params.add(ctx.tenantId)}`;
    const applicable = `
      select r.id from bulk_import_rows r
      join bulk_import_jobs j on j.id = r.job_id
      where r.execution_status = 'SUCCEEDED' and ${tenant}`;
    const violations = `
      select 'bulk_import_row'::varchar as entity_type, r.id as entity_id,
             'bulk_import_job'::varchar as related_entity_type, r.job_id as related_entity_id,
             null::uuid as dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'SUCCEEDED row has more than one SUCCEEDED attempt'::varchar as message,
             json_build_object('bulkImportRowId', r.id, 'succeededAttemptCount', a.cnt) as evidence
        from bulk_import_rows r
        join bulk_import_jobs j on j.id = r.job_id
        join lateral (
          select count(*)::int as cnt
            from bulk_import_row_attempts att
           where att.row_id = r.id and att.status = 'SUCCEEDED'
        ) a on true
       where r.execution_status = 'SUCCEEDED' and ${tenant} and a.cnt > 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtdStructural('REC-SCOPE-001', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 's.dispensing_point_id' });
    const applicable = `select s.id from user_point_scopes s where s.revoked_at is null and ${scoped}`;
    const violations = `
      select 'user_point_scope'::varchar as entity_type, (array_agg(s.id))[1] as entity_id,
             null::varchar as related_entity_type, null::uuid as related_entity_id,
             s.dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'Duplicate active point grants for the same user and point'::varchar as message,
             json_build_object(
               'userId', s.user_id,
               'dispensingPointId', s.dispensing_point_id,
               'activeGrantCount', count(*)
             ) as evidence
        from user_point_scopes s
       where s.revoked_at is null and ${scoped}
       group by s.user_id, s.dispensing_point_id
      having count(*) > 1`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtdStructural('REC-SCOPE-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 's.dispensing_point_id' });
    const applicable = `select s.id from user_point_scopes s where s.revoked_at is null and ${scoped}`;
    const violations = `
      select 'user_point_scope'::varchar as entity_type, s.id as entity_id,
             'dispensing_point'::varchar as related_entity_type, s.dispensing_point_id as related_entity_id,
             s.dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'Active grant points to a missing dispensing point'::varchar as message,
             json_build_object('userPointScopeId', s.id, 'dispensingPointId', s.dispensing_point_id) as evidence
        from user_point_scopes s
        left join dispensing_points dp on dp.id = s.dispensing_point_id
       where s.revoked_at is null and ${scoped} and dp.id is null`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtdStructural('REC-SCOPE-003', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 's.dispensing_point_id' });
    const applicable = `select s.id from user_point_scopes s where s.revoked_at is null and ${scoped}`;
    const violations = `
      select 'user_point_scope'::varchar as entity_type, s.id as entity_id,
             'dispensing_point'::varchar as related_entity_type, s.dispensing_point_id as related_entity_id,
             s.dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'Active grant points to a currently inactive dispensing point'::varchar as message,
             json_build_object(
               'userPointScopeId', s.id,
               'dispensingPointId', s.dispensing_point_id,
               'pointActive', false
             ) as evidence
        from user_point_scopes s
        join dispensing_points dp on dp.id = s.dispensing_point_id
       where s.revoked_at is null and ${scoped} and dp.active = false`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtdStructural('REC-SCOPE-004', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 's.dispensing_point_id' });
    const applicable = `
      select s.id from user_point_scopes s
      join user_organization_roles uor on uor.user_id = s.user_id and uor.active = true
      join roles r on r.id = uor.role_id
      where s.revoked_at is null and r.code = 'MEDICARTE_OPERATOR' and ${scoped}`;
    const violations = `
      select 'user_point_scope'::varchar as entity_type, s.id as entity_id,
             'dispensing_point'::varchar as related_entity_type, s.dispensing_point_id as related_entity_id,
             s.dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'Medicarte grant points to a dispensing point outside MEDICARTE'::varchar as message,
             json_build_object(
               'userPointScopeId', s.id,
               'dispensingPointId', s.dispensing_point_id,
               'pointOrganizationId', dp.organization_id
             ) as evidence
        from user_point_scopes s
        join dispensing_points dp on dp.id = s.dispensing_point_id
        join organizations org on org.id = dp.organization_id
        join user_organization_roles uor on uor.user_id = s.user_id and uor.active = true
        join roles r on r.id = uor.role_id
       where s.revoked_at is null
         and ${scoped}
         and r.code = 'MEDICARTE_OPERATOR'
         and org.code is distinct from 'MEDICARTE'`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  mtdStructural('REC-SCOPE-005', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, { point: 's.dispensing_point_id' });
    const applicable = `select s.id from user_point_scopes s where ${scoped}`;
    const violations = `
      select 'user_point_scope'::varchar as entity_type, s.id as entity_id,
             'user'::varchar as related_entity_type, s.granted_by as related_entity_id,
             s.dispensing_point_id, null::uuid as planning_period_id, null::varchar as commercial_code,
             'Point grant was created by an actor without MTD_ADMIN'::varchar as message,
             json_build_object('userPointScopeId', s.id, 'grantedBy', s.granted_by) as evidence
        from user_point_scopes s
       where ${scoped}
         and not exists (
         select 1
           from user_organization_roles uor
           join roles r on r.id = uor.role_id
           join organizations org on org.id = uor.organization_id
          where uor.user_id = s.granted_by
            and uor.active = true
            and r.code = 'MTD_ADMIN'
            and org.code = 'MTD'
       )`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  always('REC-LEG-001', (ctx) => {
    if (!ctx.legacyScan) return empty();
    if (ctx.legacyScan.status === 'PASS') return empty(1);
    return {
      evaluatedCount: 1,
      totalDetected: 1,
      findings: [
        {
          entityType: 'release',
          entityId: null,
          relatedEntityType: null,
          relatedEntityId: null,
          dispensingPointId: null,
          planningPeriodId: null,
          commercialCode: null,
          message: 'Legacy operational usage scan reported leftover usage in modern runtime',
          evidence: phiSafeEvidence({
            scanStatus: ctx.legacyScan.status,
            hitCount: ctx.legacyScan.hitCount,
          }),
        },
      ],
    };
  }),
  mtd('REC-LEG-002', async (ctx) => {
    const params = new SqlParams();
    const scoped = scopeSql(params, ctx.scope, {
      period: 'ps.planning_period_id',
      point: 'pa.dispensing_point_id',
      code: 'pa.commercial_code',
    });
    const applicable = `
      select a.id from patient_application_audits a
      join patient_applications pa on pa.id = a.patient_application_id
      join patient_schedules ps on ps.id = pa.patient_schedule_id
      where a.status in ('APPROVED','REJECTED') and ${scoped}`;
    const violations = `
      select 'patient_application_audit'::varchar as entity_type, a.id as entity_id,
             'authorization_item'::varchar as related_entity_type, a.authorization_item_id as related_entity_id,
             pa.dispensing_point_id, ps.planning_period_id, pa.commercial_code,
             'Modern audit status diverges from leftover compatibility audit_status'::varchar as message,
             json_build_object(
               'patientApplicationAuditId', a.id,
               'modernStatus', a.status,
               'leftoverAuditStatus', ai.audit_status
             ) as evidence
        from patient_application_audits a
        join patient_applications pa on pa.id = a.patient_application_id
        join patient_schedules ps on ps.id = pa.patient_schedule_id
        join authorization_items ai on ai.id = a.authorization_item_id
       where a.status in ('APPROVED','REJECTED')
         and ${scoped}
         and ai.audit_status is distinct from a.status`;
    return detect(ctx, applicable, params.values, violations, params.values);
  }),
  observationPass('REC-LEG-004', (ctx) => {
    void ctx;
    return {
      sql: `
        select ai.id
          from authorization_items ai
         where not exists (select 1 from patient_schedules ps where ps.authorization_item_id = ai.id)
           and not exists (select 1 from patient_applications pa where pa.authorization_item_id = ai.id)`,
      values: [],
    };
  }),
];
