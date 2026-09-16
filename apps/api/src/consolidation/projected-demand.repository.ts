import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import { sumDemandQuantities, type DemandSourceClassification } from '@authorization/domain';
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

type LoadedAuthorizationRow = Readonly<{
  id: string;
  quantity: number;
  commercial_code: string;
  loaded_at: string;
}>;

type DesiredSource = Readonly<{
  authorizationItemId: string;
  quantity: number;
  classification: DemandSourceClassification;
  loadedAt: string;
}>;

type DesiredLine = {
  dispensingPointId: string | null;
  commercialCode: string;
  regularQuantity: number;
  lateQuantity: number;
  projectedQuantity: number;
  sources: DesiredSource[];
};

type ExistingLineRow = Readonly<{
  id: string;
  dispensing_point_id: string | null;
  commercial_code: string;
  regular_quantity: number;
  late_quantity: number;
  projected_quantity: number;
  revision: number;
}>;

type ExistingSourceRow = Readonly<{
  projected_demand_line_id: string;
  authorization_item_id: string | null;
  quantity: number;
  loaded_at: string | null;
}>;

type DemandLineJoinedRow = Readonly<{
  id: string;
  planning_period_id: string;
  planning_period_start_date: string;
  planning_period_end_date: string;
  dispensing_point_id: string | null;
  dispensing_point_code: string | null;
  dispensing_point_name: string | null;
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
  authorization_item_id: string;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  quantity: number;
  loaded_at: string;
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
  *   → Lectura consistente de autorizaciones cargadas habilitadas. El cargue
  *     debe aportar CANTIDAD y FECHA_ASIGNACION en source_data.
  *   → La fecha ubica la autorización en el período; la cantidad cargada es la
  *     demanda proyectada y el punto se selecciona posteriormente en la OC.
 *   → Reconciliación de projected_demand_lines y demand_sources con guardas
 *     de cambio (idempotencia: nada se acumula ni duplica, y consolidar dos
 *     veces sin cambios no reescribe).
 *   → Verificación transaccional de las invariantes de suma y de la
 *     existencia de las autorizaciones cargadas.
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

      // 2. El cargue de autorizaciones es la fuente clínica y logística.
      const authorizations = await tx.execute<LoadedAuthorizationRow>(sql`
         select ai.id,
                case when (ai.source_data->>'CANTIDAD') ~ '^[0-9]+$'
                     then (ai.source_data->>'CANTIDAD')::int end as quantity,
                ai.codigo_medicamento as commercial_code,
                to_char(ai.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as loaded_at
         from authorization_items ai
         join planning_periods pp
           on case when (ai.source_data->>'FECHA_ASIGNACION') ~ '^\\d{4}-\\d{2}-\\d{2}$'
                   then to_date(ai.source_data->>'FECHA_ASIGNACION', 'YYYY-MM-DD') end
               between pp.start_date and pp.end_date
         where ai.enablement_status = 'ENABLED'
           and (ai.source_data->>'CANTIDAD') ~ '^[1-9][0-9]*$'
           and pp.id = ${input.periodId}
       `);

       // 3. Agrupación directa por período y código. Las autorizaciones cargadas
      // siempre son volumen REGULAR; no existe clasificación por agendamiento.
      const desiredByLine = new Map<string, DesiredLine>();
      for (const authorization of authorizations.rows) {
        const identity = authorization.commercial_code;
        const line = desiredByLine.get(identity) ?? {
          dispensingPointId: null,
          commercialCode: authorization.commercial_code,
          regularQuantity: 0,
          lateQuantity: 0,
          projectedQuantity: 0,
          sources: [] as DesiredSource[],
        };
        line.sources.push({
          authorizationItemId: authorization.id,
          quantity: authorization.quantity,
          classification: 'REGULAR',
          loadedAt: authorization.loaded_at,
        });
        desiredByLine.set(identity, line);
      }
      for (const line of desiredByLine.values()) {
        line.sources.sort((a, b) => a.authorizationItemId.localeCompare(b.authorizationItemId));
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
     left join dispensing_points dp on dp.id = pdl.dispensing_point_id
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
      left join dispensing_points dp on dp.id = pdl.dispensing_point_id
      left join demand_sources ds on ds.projected_demand_line_id = pdl.id
      where pdl.id = ${id}
      group by pdl.id, pp.start_date, pp.end_date, dp.code, dp.name
    `);
    const row = rows.rows[0];
    return row ? toDemandLine(row) : null;
  }

  async listSources(line: ProjectedDemandLineResponse): Promise<ProjectedDemandSourceResponse[]> {
    const rows = await this.database.db.execute<DemandSourceJoinedRow>(sql`
       select ai.id as authorization_item_id,
             ai.numero_autorizacion as authorization_number,
             coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO') as patient_document,
             ai.source_data->>'NOMBRE_PACIENTE' as patient_name,
              ds.quantity,
              to_char(coalesce(ds.loaded_at, ai.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as loaded_at
       from demand_sources ds
       join authorization_items ai on ai.id = ds.authorization_item_id
       where ds.projected_demand_line_id = ${line.id}
       order by ds.quantity desc, ai.numero_autorizacion, ai.id
    `);
    return rows.rows.map(toDemandSource);
  }

  /**
   * Reconciliación de líneas + fuentes del período. Estrategia: guardas de
   * cambio; no se reescribe lo igual y las fuentes no deseadas se eliminan.
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
      existingLines.rows.map((row) => [row.commercial_code, row]),
    );

    const existingSources = await tx.execute<ExistingSourceRow>(sql`
       select ds.projected_demand_line_id,
              ds.authorization_item_id,
              ds.quantity,
              ds.loaded_at
      from demand_sources ds
      join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
      where pdl.planning_period_id = ${input.periodId}
    `);
    const sourcesByLine = new Map<string, Map<string, ExistingSourceRow>>();
    for (const source of existingSources.rows) {
      const bucket =
        sourcesByLine.get(source.projected_demand_line_id) ?? new Map<string, ExistingSourceRow>();
      bucket.set(`${source.authorization_item_id}`, source);
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
      const currentSources = sourcesByLine.get(lineId) ?? new Map<string, ExistingSourceRow>();
      const sourcesChanged =
        fingerprint(desired.sources) !==
        [...currentSources.values()]
          .map((source) => `${source.authorization_item_id}|${source.quantity}|${source.loaded_at}`)
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
           (projected_demand_line_id, authorization_item_id, quantity,
            planning_period_id, dispensing_point_id, commercial_code, schedule_timing,
             late_handling, demand_bucket, loaded_at)
         select
           ${lineId},
           ai.id,
           ${source.quantity},
           ${periodId},
           ${desired.dispensingPointId},
           ${desired.commercialCode},
           'ON_TIME',
           null,
           ${source.classification},
           ${source.loadedAt}
         from authorization_items ai
         where ai.id = ${source.authorizationItemId}
      `);
    }
  }

  /**
   * Verificación transaccional de las invariantes agregadas. Se usa
   * verificación explícita y FKs, NO un trigger complejo de suma:
   * - SUM(sources.quantity) == projected_quantity;
   * - SUM(fuentes REGULAR) == regular_quantity;
   * - las fuentes apuntan a autorizaciones cargadas existentes.
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
    const missingAuthorization = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count
      from demand_sources ds
       left join authorization_items ai on ai.id = ds.authorization_item_id
       where ds.authorization_item_id is not null and ai.id is null
    `);
    if ((missingAuthorization.rows[0]?.count ?? 0) > 0) {
      throw new Error('Demand source references an authorization that is no longer available');
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
    .map((source) => `${source.authorizationItemId}|${source.quantity}|${source.loadedAt}`)
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
    authorizationItemId: row.authorization_item_id,
    authorizationNumber: row.authorization_number,
    patientDocument: row.patient_document,
    patientName: row.patient_name,
    quantity: row.quantity,
    loadedAt: row.loaded_at,
  };
}
