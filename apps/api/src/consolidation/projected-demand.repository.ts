import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import {
  DemandConsolidationError,
  resolveEffectiveSchedulePeriod,
  sumDemandQuantities,
  type DemandSourceClassification,
} from '@authorization/domain';
import type {
  ConsolidateProjectedDemandResponse,
  ProjectedDemandListQuery,
  ProjectedDemandLineResponse,
  ProjectedDemandSourceResponse,
} from '@authorization/contracts';
import { DATABASE } from '../tokens';

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database['db']['transaction']>[0]>[0];

export type DemandConsolidationActor = Readonly<{
  userId: string;
  organizationId: string;
  correlationId: string;
}>;

export type ConsolidateOutcome =
  | { outcome: 'consolidated'; summary: ConsolidateProjectedDemandResponse }
  | { outcome: 'period_not_found' };

type ActiveScheduleRow = Readonly<{
  id: string;
  quantity: number;
  revision: number;
  schedule_timing: 'ON_TIME' | 'LATE';
  late_handling: 'COMPLEMENTARY_PURCHASE_ORDER' | 'NEXT_PERIOD' | null;
  planning_period_id: string;
  deferred_planning_period_id: string | null;
  dispensing_point_id: string;
  commercial_code: string;
}>;

type DesiredSource = Readonly<{
  patientScheduleId: string;
  scheduleRevision: number;
  quantity: number;
  scheduleTiming: 'ON_TIME' | 'LATE';
  lateHandling: 'COMPLEMENTARY_PURCHASE_ORDER' | 'NEXT_PERIOD' | null;
  classification: DemandSourceClassification;
}>;

type DesiredLine = {
  dispensingPointId: string;
  commercialCode: string;
  regularQuantity: number;
  lateQuantity: number;
  projectedQuantity: number;
  sources: DesiredSource[];
};

type ExistingLineRow = Readonly<{
  id: string;
  dispensing_point_id: string;
  commercial_code: string;
  regular_quantity: number;
  late_quantity: number;
  projected_quantity: number;
  revision: number;
}>;

type ExistingSourceRow = Readonly<{
  projected_demand_line_id: string;
  patient_schedule_id: string;
  schedule_revision: number;
  quantity: number;
  schedule_timing: 'ON_TIME' | 'LATE';
}>;

type DemandLineJoinedRow = Readonly<{
  id: string;
  planning_period_id: string;
  planning_period_start_date: string;
  planning_period_end_date: string;
  dispensing_point_id: string;
  dispensing_point_code: string;
  dispensing_point_name: string;
  commercial_code: string;
  regular_quantity: number;
  late_quantity: number;
  projected_quantity: number;
  status: string;
  revision: number;
  created_by: string;
  updated_by: string;
  source_count: number;
  consolidated_at: string | null;
}>;

type DemandSourceJoinedRow = Readonly<{
  patient_schedule_id: string;
  schedule_revision: number;
  authorization_item_id: string;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  scheduled_date: string;
  quantity: number;
  schedule_timing: 'ON_TIME' | 'LATE';
  late_handling: 'COMPLEMENTARY_PURCHASE_ORDER' | 'NEXT_PERIOD' | null;
}>;

const DEMAND_LINE_COLUMNS = sql`
  pdl.id,
  pdl.planning_period_id,
  to_char(pp.start_date, 'YYYY-MM-DD') as planning_period_start_date,
  to_char(pp.end_date, 'YYYY-MM-DD') as planning_period_end_date,
  pdl.dispensing_point_id,
  dp.code as dispensing_point_code,
  dp.name as dispensing_point_name,
  pdl.commercial_code,
  pdl.regular_quantity,
  pdl.late_quantity,
  pdl.projected_quantity,
  pdl.status,
  pdl.revision,
  pdl.created_by,
  pdl.updated_by,
  count(ds.id)::int as source_count,
  to_char(pdl.consolidated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as consolidated_at
`;

/**
 * ESP-004: proyecto y consolidación idempotente de la demanda proyectada.
 *
 * Algoritmo consolidarPeríodo(periodId):
 *   BEGIN
 *   → FOR UPDATE del planning_period: serializa consolidaciones concurrentes
 *     del mismo período; períodos distintos corren independientes.
 *   → Lectura (read-only, consistente) de patient_schedules VIGENTES
 *     (SCHEDULED/RESCHEDULED). CANCELLED no participa y
 *     patient_schedule_history nunca se suma directamente; la cantidad
 *     fuente es snapshot de la revisión referenciada.
 *   → Resolución del período efectivo con la función pura del dominio
 *     (`resolveEffectiveSchedulePeriod`): LATE+NEXT_PERIOD sin período
 *     diferido falla explícitamente, sin deduplicación silenciosa.
 *   → Agrupación por (effectivePeriod, point, commercial_code), SIN DISTINCT.
 *   → Reconciliación de projected_demand_lines y demand_sources con guardas
 *     de cambio (idempotencia: nada se acumula ni duplica, y consolidar dos
 *     veces sin cambios no reescribe).
 *   → Verificación transaccional de las invariantes de suma (incluida la
 *     coincidencia del snapshot con patient_schedule_history).
 *   → audit_event PROJECTED_DEMAND_CONSOLIDATED con resumen.
 *   COMMIT (una sola transacción, sin escrituras parciales).
 */
@Injectable()
export class ProjectedDemandRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async consolidate(input: {
    periodId: string;
    actor: DemandConsolidationActor;
  }): Promise<ConsolidateOutcome> {
    return this.database.db.transaction(async (tx) => {
      // 1. Lock del período: serializa consolidaciones concurrentes del mismo
      // período; distintos períodos usan filas distintas y no se bloquean.
      const period = await tx.execute<{
        id: string;
      }>(sql`
        select id
        from planning_periods
        where id = ${input.periodId}
        for update
      `);
      if (!period.rows[0]) return { outcome: 'period_not_found' as const };

      // 2. Lectura consistente de schedules vigentes (sin lock de filas:
      //    consolidar no los modifica).
      const schedules = await tx.execute<ActiveScheduleRow>(sql`
        select ps.id,
               ps.quantity,
               ps.revision,
               ps.schedule_timing,
               ps.late_handling,
               ps.planning_period_id,
               ps.deferred_planning_period_id,
               ps.dispensing_point_id,
               ps.commercial_code
        from patient_schedules ps
        where ps.status in ('SCHEDULED', 'RESCHEDULED')
      `);

      // 3. Resolución del período efectivo + bucket + agrupación. La
      //    clasificación (REGULAR/LATE) se resuelve con la regla del dominio
      //    y los hechos históricos (scheduleTiming/lateHandling) se
      //    conservan como snapshot en demand_sources.
      const desiredByLine = new Map<string, DesiredLine>();
      for (const schedule of schedules.rows) {
        if (schedule.quantity <= 0) {
          throw new DemandConsolidationError(
            schedule.id,
            `Active schedule ${schedule.id} has a non-positive quantity`,
          );
        }
        const effective = resolveEffectiveSchedulePeriod({
          scheduleTiming: schedule.schedule_timing,
          lateHandling: schedule.late_handling,
          planningPeriodId: schedule.planning_period_id,
          deferredPlanningPeriodId: schedule.deferred_planning_period_id,
        });
        if (effective.effectivePeriodId !== input.periodId) continue;

        const identity = `${schedule.dispensing_point_id}|${schedule.commercial_code}`;
        const line = desiredByLine.get(identity) ?? {
          dispensingPointId: schedule.dispensing_point_id,
          commercialCode: schedule.commercial_code,
          regularQuantity: 0,
          lateQuantity: 0,
          projectedQuantity: 0,
          sources: [] as DesiredSource[],
        };
        line.sources.push({
          patientScheduleId: schedule.id,
          scheduleRevision: schedule.revision,
          quantity: schedule.quantity,
          scheduleTiming: schedule.schedule_timing,
          lateHandling: schedule.late_handling,
          classification: effective.classification,
        });
        desiredByLine.set(identity, line);
      }
      for (const line of desiredByLine.values()) {
        line.sources.sort((a, b) => a.patientScheduleId.localeCompare(b.patientScheduleId));
        const sums = sumDemandQuantities(
          line.sources.map((source) => ({
            quantity: source.quantity,
            classification: source.classification,
          })),
        );
        line.regularQuantity = sums.regularQuantity;
        line.lateQuantity = sums.lateQuantity;
        line.projectedQuantity = sums.projectedQuantity;
      }

      // 4. Reconciliación idempotente de líneas y fuentes.
      const consolidatedAt = await this.reconcile({
        tx,
        periodId: input.periodId,
        desiredLines: desiredByLine,
        actor: input.actor,
      });

      // 5. Verificación transaccional de invariantes.
      await this.verifySums(tx, input.periodId);

      // 6. Totales y audit_event (misma transacción). Cada métrica se calcula
      //   sobre su propia fila base: las líneas una vez y las fuentes una vez
      //   (un join directo multiplicaría las cantidades de líneas con varias
      //   fuentes).
      const totals = await tx.execute<{
        line_count: number;
        source_count: number;
        regular_quantity: number;
        late_quantity: number;
      }>(sql`
        select
          (select count(*)::int from projected_demand_lines
             where planning_period_id = ${input.periodId}) as line_count,
          (select count(*)::int from demand_sources
             where projected_demand_line_id in (
               select id from projected_demand_lines where planning_period_id = ${input.periodId}
             )) as source_count,
          (select coalesce(sum(regular_quantity), 0)::int from projected_demand_lines
             where planning_period_id = ${input.periodId}) as regular_quantity,
          (select coalesce(sum(late_quantity), 0)::int from projected_demand_lines
             where planning_period_id = ${input.periodId}) as late_quantity
      `);
      const totalsRow = totals.rows[0]!;
      const summary: ConsolidateProjectedDemandResponse = {
        planningPeriodId: input.periodId,
        lineCount: totalsRow.line_count,
        sourceCount: totalsRow.source_count,
        regularQuantity: totalsRow.regular_quantity,
        lateQuantity: totalsRow.late_quantity,
        projectedQuantity: totalsRow.regular_quantity + totalsRow.late_quantity,
        consolidatedAt,
      };
      await this.insertAuditEvent(tx, input.actor, summary);
      return { outcome: 'consolidated' as const, summary };
    });
  }

  async list(query: ProjectedDemandListQuery): Promise<ProjectedDemandLineResponse[]> {
    const filters = [sql`pdl.planning_period_id = ${query.planningPeriodId}`];
    if (query.dispensingPointId !== undefined) {
      filters.push(sql`pdl.dispensing_point_id = ${query.dispensingPointId}`);
    }
    if (query.commercialCode !== undefined) {
      filters.push(sql`pdl.commercial_code = ${query.commercialCode}`);
    }
    const rows = await this.database.db.execute<DemandLineJoinedRow>(sql`
      select ${DEMAND_LINE_COLUMNS}
      from projected_demand_lines pdl
      join planning_periods pp on pp.id = pdl.planning_period_id
      join dispensing_points dp on dp.id = pdl.dispensing_point_id
      left join demand_sources ds on ds.projected_demand_line_id = pdl.id
      where ${sql.join(filters, sql` and `)}
      group by pdl.id, pp.start_date, pp.end_date, dp.code, dp.name
      order by dp.name, dp.code, pdl.commercial_code
      limit ${query.limit}
    `);
    return rows.rows.map(toDemandLine);
  }

  async findById(id: string): Promise<ProjectedDemandLineResponse | null> {
    const rows = await this.database.db.execute<DemandLineJoinedRow>(sql`
      select ${DEMAND_LINE_COLUMNS}
      from projected_demand_lines pdl
      join planning_periods pp on pp.id = pdl.planning_period_id
      join dispensing_points dp on dp.id = pdl.dispensing_point_id
      left join demand_sources ds on ds.projected_demand_line_id = pdl.id
      where pdl.id = ${id}
      group by pdl.id, pp.start_date, pp.end_date, dp.code, dp.name
    `);
    const row = rows.rows[0];
    return row ? toDemandLine(row) : null;
  }

  async listSources(
    line: ProjectedDemandLineResponse,
  ): Promise<ProjectedDemandSourceResponse[]> {
    const rows = await this.database.db.execute<DemandSourceJoinedRow>(sql`
      select ds.patient_schedule_id,
             ds.schedule_revision,
             ai.id as authorization_item_id,
             ai.numero_autorizacion as authorization_number,
             coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO') as patient_document,
             ai.source_data->>'NOMBRE_PACIENTE' as patient_name,
             to_char(ps.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
             ds.quantity,
             ds.schedule_timing,
             ds.late_handling
      from demand_sources ds
      join patient_schedules ps on ps.id = ds.patient_schedule_id
      join authorization_items ai on ai.id = ps.authorization_item_id
      where ds.projected_demand_line_id = ${line.id}
      order by ds.quantity desc, ps.scheduled_date, ds.patient_schedule_id
    `);
    return rows.rows.map(toDemandSource);
  }

  /**
   * Reconciliación de líneas + fuentes del período. Estrategia: guardas de
   * cambio; no se reescribe lo igual, las fuentes no deseadas se eliminan y
   * las deseadas se reconciliarán contra `patient_schedule_history` snapshot.
   */
  private async reconcile(input: {
    tx: Transaction;
    periodId: string;
    desiredLines: Map<string, DesiredLine>;
    actor: DemandConsolidationActor;
  }): Promise<string> {
    const { tx } = input;

    const existingLines = await tx.execute<ExistingLineRow>(sql`
      select id, dispensing_point_id, commercial_code,
             regular_quantity, late_quantity, projected_quantity, revision
      from projected_demand_lines
      where planning_period_id = ${input.periodId}
      for update
    `);
    const existingLineByKey = new Map(
      existingLines.rows.map((row) => [
        `${row.dispensing_point_id}|${row.commercial_code}`,
        row,
      ]),
    );

    const existingSources = await tx.execute<ExistingSourceRow>(sql`
      select ds.projected_demand_line_id,
             ds.patient_schedule_id,
             ds.schedule_revision,
             ds.quantity,
             ds.schedule_timing
      from demand_sources ds
      join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
      where pdl.planning_period_id = ${input.periodId}
    `);
    const sourcesByLine = new Map<string, Map<string, ExistingSourceRow>>();
    for (const source of existingSources.rows) {
      const bucket =
        sourcesByLine.get(source.projected_demand_line_id) ??
        new Map<string, ExistingSourceRow>();
      bucket.set(
        `${source.patient_schedule_id}|${source.schedule_revision}`,
        source,
      );
      sourcesByLine.set(source.projected_demand_line_id, bucket);
    }

    const reconciledLineIds = new Set<string>();
    for (const [identityKey, desired] of input.desiredLines) {
      const existingLine = existingLineByKey.get(identityKey);
      if (!existingLine) {
        const inserted = await tx.execute<{ id: string }>(sql`
          insert into projected_demand_lines
            (planning_period_id, dispensing_point_id, commercial_code,
             regular_quantity, late_quantity, projected_quantity, status,
             revision, consolidated_at, created_by, updated_by)
          values (
            ${input.periodId},
            ${desired.dispensingPointId},
            ${desired.commercialCode},
            ${desired.regularQuantity},
            ${desired.lateQuantity},
            ${desired.projectedQuantity},
            'OPEN',
            1,
            now(),
            ${input.actor.userId},
            ${input.actor.userId}
          )
          returning id
        `);
        const lineId = inserted.rows[0]!.id;
        await this.insertDesiredSources(tx, lineId, input.periodId, desired);
        reconciledLineIds.add(lineId);
        continue;
      }

      const lineId = existingLine.id;
      const currentSources =
        sourcesByLine.get(lineId) ??
        new Map<string, { patient_schedule_id: string; schedule_revision: number; quantity: number; schedule_timing: 'ON_TIME' | 'LATE' }>();
      const sourcesChanged =
        fingerprint(desired.sources) !==
        [...currentSources.values()]
          .map(
            (source) =>
              `${source.patient_schedule_id}|${source.schedule_revision}|${source.quantity}|${source.schedule_timing}`,
          )
          .sort()
          .join(',');
      if (sourcesChanged) {
        await tx.execute(sql`
          delete from demand_sources where projected_demand_line_id = ${lineId}
        `);
        await this.insertDesiredSources(tx, lineId, input.periodId, desired);
      }
      const quantitiesChanged =
        existingLine.regular_quantity !== desired.regularQuantity ||
        existingLine.late_quantity !== desired.lateQuantity ||
        existingLine.projected_quantity !== desired.projectedQuantity;
      // Versionado semántico: la revisión de la línea avanza ante ANY cambio
      // material: cantidad (regular/late/projected) o composición de fuentes
      // (fingerprint). Igual estado lógico → sin escritura.
      if (quantitiesChanged || sourcesChanged) {
        await tx.execute(sql`
          update projected_demand_lines
          set regular_quantity = ${desired.regularQuantity},
              late_quantity = ${desired.lateQuantity},
              projected_quantity = ${desired.projectedQuantity},
              revision = revision + 1,
              consolidated_at = now(),
              updated_at = now(),
              updated_by = ${input.actor.userId}
          where id = ${lineId}
        `);
      }
      reconciledLineIds.add(lineId);
    }

    // Líneas del período que ya no tienen fuentes deseadas: sus fuentes
    // quedaron desactualizadas (cancelación / cambio de punto / NEXT_PERIOD /
    // cambio de período) y una línea vacía violaría projected_quantity > 0.
    // Se borran fuentes desactualizadas + la línea (reconciliación completa,
    // sin dejar residuos silenciosos).
    for (const row of existingLines.rows) {
      if (reconciledLineIds.has(row.id)) continue;
      await tx.execute(sql`
        delete from demand_sources where projected_demand_line_id = ${row.id}
      `);
      await tx.execute(sql`
        delete from projected_demand_lines where id = ${row.id}
      `);
    }

    const stamped = await tx.execute<{ executed_at: string }>(sql`
      select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as executed_at
    `);
    return stamped.rows[0]!.executed_at;
  }

  private async insertDesiredSources(
    tx: Transaction,
    lineId: string,
    periodId: string,
    desired: DesiredLine,
  ): Promise<void> {
    for (const source of desired.sources) {
      await tx.execute(sql`
        insert into demand_sources
          (projected_demand_line_id, patient_schedule_id, schedule_revision, quantity,
           planning_period_id, dispensing_point_id, commercial_code, schedule_timing,
           late_handling, demand_bucket)
        select
          ${lineId},
          ps.id,
          ps.revision,
          hsh.quantity,
          ${periodId},
          ${desired.dispensingPointId},
        ${desired.commercialCode},
          ps.schedule_timing,
          ps.late_handling,
          ${source.classification}
        from patient_schedules ps
        join patient_schedule_history hsh
          on hsh.patient_schedule_id = ps.id and hsh.revision = ps.revision
        where ps.id = ${source.patientScheduleId}
          and ps.revision = ${source.scheduleRevision}
      `);
    }
  }

  /**
   * Verificación transaccional de las invariantes agregadas. Se usa
   * verificación explícita y FKs, NO un trigger complejo de suma:
   * - SUM(sources.quantity) == projected_quantity;
   * - SUM(fuentes ON_TIME) == regular_quantity;
   * - SUM(fuentes LATE) == late_quantity;
   * - el snapshot de cada fuente coincide con patient_schedule_history
   *   (lineage trazable revisión a revisión).
   */
  private async verifySums(tx: Transaction, periodId: string): Promise<void> {
    const mismatched = await tx.execute<{ id: string }>(sql`
      select pdl.id
      from projected_demand_lines pdl
      left join demand_sources ds on ds.projected_demand_line_id = pdl.id
      where pdl.planning_period_id = ${periodId}
      group by pdl.id, pdl.regular_quantity, pdl.late_quantity, pdl.projected_quantity
      having
        coalesce(sum(ds.quantity), 0) <> pdl.projected_quantity
        or coalesce(sum(ds.quantity) filter (where ds.demand_bucket = 'REGULAR'), 0)
             <> pdl.regular_quantity
        or coalesce(sum(ds.quantity) filter (where ds.demand_bucket = 'LATE'), 0)
             <> pdl.late_quantity
    `);
    if (mismatched.rows.length > 0) {
      throw new Error(
        `Projected demand sums do not reconcile for lines: ${mismatched.rows
          .map((row) => row.id)
          .join(', ')}`,
      );
    }
    const snapshotMismatch = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count
      from demand_sources ds
      join patient_schedule_history hsh
        on hsh.patient_schedule_id = ds.patient_schedule_id
       and hsh.revision = ds.schedule_revision
      where ds.quantity <> hsh.quantity
    `);
    if ((snapshotMismatch.rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Demand source snapshot quantity differs from the referenced schedule revision',
      );
    }
  }

  private async insertAuditEvent(
    tx: Transaction,
    actor: DemandConsolidationActor,
    summary: ConsolidateProjectedDemandResponse,
  ): Promise<void> {
    await tx.execute(sql`
      insert into audit_events
        (actor_type, actor_id, organization_id, action, resource_type, resource_id,
         before, after, correlation_id, request_id, result)
      values (
        'USER',
        ${actor.userId},
        ${actor.organizationId},
        'PROJECTED_DEMAND_CONSOLIDATED',
        'planning_period',
        ${summary.planningPeriodId},
        null,
        ${JSON.stringify({
          lines: summary.lineCount,
          sources: summary.sourceCount,
          regularQuantity: summary.regularQuantity,
          lateQuantity: summary.lateQuantity,
          totalQuantity: summary.projectedQuantity,
        })}::jsonb,
        ${actor.correlationId},
        ${actor.correlationId},
        'SUCCESS'
      )
    `);
  }
}



function fingerprint(sources: readonly DesiredSource[]): string {
  return sources
    .map(
      (source) =>
        `${source.patientScheduleId}|${source.scheduleRevision}|${source.quantity}|${source.scheduleTiming}`,
    )
    .sort()
    .join(',');
}

function toDemandLine(row: DemandLineJoinedRow): ProjectedDemandLineResponse {
  return {
    id: row.id,
    planningPeriodId: row.planning_period_id,
    planningPeriodStartDate: row.planning_period_start_date,
    planningPeriodEndDate: row.planning_period_end_date,
    dispensingPointId: row.dispensing_point_id,
    dispensingPointCode: row.dispensing_point_code,
    dispensingPointName: row.dispensing_point_name,
    commercialCode: row.commercial_code,
    regularQuantity: row.regular_quantity,
    lateQuantity: row.late_quantity,
    projectedQuantity: row.projected_quantity,
    sourceCount: row.source_count,
    status: row.status as 'OPEN' | 'FROZEN' | 'CLOSED',
    revision: row.revision,
    consolidatedAt: row.consolidated_at as string,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function toDemandSource(row: DemandSourceJoinedRow): ProjectedDemandSourceResponse {
  return {
    patientScheduleId: row.patient_schedule_id,
    scheduleRevision: row.schedule_revision,
    authorizationItemId: row.authorization_item_id,
    authorizationNumber: row.authorization_number,
    patientDocument: row.patient_document,
    patientName: row.patient_name,
    scheduledDate: row.scheduled_date,
    quantity: row.quantity,
    scheduleTiming: row.schedule_timing,
    lateHandling: row.late_handling,
  };
}
