import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '@authorization/database';
import {
  authorizationPurchaseMonthEnd,
  currentBogotaDate,
  projectFungibleAuthorizationCoverage,
  sumDemandQuantities,
  type DemandSourceClassification,
} from '@authorization/domain';
import type {
  ConsolidateProjectedDemandResponse,
  ProjectedDemandCoverageProjectionResponse,
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
  scheduleTiming: 'ON_TIME';
  lateHandling: null;
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
  patient_schedule_id: string | null;
  schedule_revision: number | null;
  authorization_item_id: string | null;
  quantity: number;
  schedule_timing: 'ON_TIME' | 'LATE';
  late_handling: 'COMPLEMENTARY_PURCHASE_ORDER' | 'NEXT_PERIOD' | null;
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
  patient_schedule_id: string | null;
  schedule_revision: number | null;
  schedule_timing: string | null;
  late_handling: string | null;
  authorization_item_id: string;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  quantity: number;
  loaded_at: string;
}>;

type CoverageProjectionSourceRow = Readonly<{
  authorization_item_id: string;
  authorization_number: string;
  patient_document: string | null;
  patient_name: string | null;
  demand_bucket: 'REGULAR' | 'LATE';
  quantity: number;
  assignment_date: string;
  expiration_date: string;
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
 *   → Macro 3A: la demanda de compra nace exclusivamente de autorizaciones
 *     vigentes y elegibles. La programación de MEDICARTE queda fuera de la
 *     decisión de cantidad, punto y fecha para comprar.
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

      // 2. Macro 3A: la fuente de verdad para la demanda de compra es
      // authorization_items. MEDICARTE/patient_schedules no determina
      // cantidad, punto, fecha ni elegibilidad de compra.
      //
      // planning_period_id identifica este snapshot operativo de demanda.
      //
      // Wave 1:
      // FECHA_ASIGNACION representa el inicio de vigencia operativa de la AUTO.
      // Una AUTO participa si su inicio pertenece al mes operativo actual
      // o a un mes anterior. No se anticipan compras de meses futuros.
      //
      // No se exige FECHA_ASIGNACION <= hoy: una autorización que inicia
      // posteriormente dentro del mismo mes actual sí puede participar.
      const todayBogota = currentBogotaDate();
      const currentMonthEnd = authorizationPurchaseMonthEnd(todayBogota);

      const authorizations = await tx.execute<LoadedAuthorizationRow>(sql`
          select
            ai.id,
            (ai.source_data->>'CANTIDAD')::int as quantity,
            ai.codigo_medicamento as commercial_code,
            to_char(
              ai.created_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ) as loaded_at
          from authorization_items ai
          join import_batches ib
            on ib.id = ai.created_from_batch_id
           and ib.organization_id = ${input.actor.organizationId}
          join tariff_annex_products tap
            on tap.codigo_producto = ai.codigo_medicamento
           and tap.organization_id = ${input.actor.organizationId}
           and tap.active = true
           and regexp_replace(
             upper(trim(coalesce(tap.tipo_inclusion, ''))),
             '\\s+',
             '_',
             'g'
           ) = 'PBS'
          where ai.enablement_status = 'ENABLED'
            and (ai.source_data->>'CANTIDAD') ~ '^[1-9][0-9]*$'
            and (ai.source_data->>'FECHA_ASIGNACION')
                  ~ '^\\d{4}-\\d{2}-\\d{2}$'
            and (ai.source_data->>'FECHA_ASIGNACION')
                  <= ${currentMonthEnd}
            and (ai.source_data->>'FECHA_FINAL_VIGENCIA')
                  ~ '^\\d{4}-\\d{2}-\\d{2}$'
            and (ai.source_data->>'FECHA_FINAL_VIGENCIA')
                  >= ${todayBogota}
        `);

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
          scheduleTiming: 'ON_TIME',
          lateHandling: null,
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
             where planning_period_id = ${input.periodId}
               and dispensing_point_id is null) as line_count,
          (select count(*)::int from demand_sources
             where projected_demand_line_id in (
               select id
               from projected_demand_lines
               where planning_period_id = ${input.periodId}
                 and dispensing_point_id is null
             )) as source_count,
          (select coalesce(sum(regular_quantity), 0)::int from projected_demand_lines
             where planning_period_id = ${input.periodId}
               and dispensing_point_id is null) as regular_quantity,
          (select coalesce(sum(late_quantity), 0)::int from projected_demand_lines
             where planning_period_id = ${input.periodId}
               and dispensing_point_id is null) as late_quantity
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
    } else {
      filters.push(sql`pdl.dispensing_point_id is null`);
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
       select ds.patient_schedule_id, ds.schedule_revision, ds.schedule_timing, ds.late_handling,
              coalesce(ai.id, ps.authorization_item_id) as authorization_item_id,
             ai.numero_autorizacion as authorization_number,
             coalesce(ai.source_data->>'IDENTIFICACION_PACIENTE', ai.source_data->>'NUM_DOCUMENTO') as patient_document,
             ai.source_data->>'NOMBRE_PACIENTE' as patient_name,
              ds.quantity,
               to_char(coalesce(ds.loaded_at, ps.created_at, ai.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as loaded_at
       from demand_sources ds
       left join patient_schedules ps on ps.id = ds.patient_schedule_id
       join authorization_items ai on ai.id = coalesce(ds.authorization_item_id, ps.authorization_item_id)
       where ds.projected_demand_line_id = ${line.id}
       order by ds.quantity desc, ai.numero_autorizacion, coalesce(ds.authorization_item_id, ps.authorization_item_id)
    `);
    return rows.rows.map(toDemandSource);
  }

  async coverageProjection(
    line: ProjectedDemandLineResponse,
  ): Promise<ProjectedDemandCoverageProjectionResponse> {
    const sources = await this.database.db.execute<CoverageProjectionSourceRow>(sql`
        select
          ai.id
            as authorization_item_id,
          ai.numero_autorizacion
            as authorization_number,
          coalesce(
            ai.source_data->>'IDENTIFICACION_PACIENTE',
            ai.source_data->>'NUM_DOCUMENTO'
          )
            as patient_document,
          ai.source_data->>'NOMBRE_PACIENTE'
            as patient_name,
          ds.demand_bucket,
          ds.quantity,
          ai.source_data->>'FECHA_ASIGNACION'
            as assignment_date,
          ai.source_data->>'FECHA_FINAL_VIGENCIA'
            as expiration_date
        from demand_sources ds
        join authorization_items ai
          on ai.id =
             ds.authorization_item_id
        where ds.projected_demand_line_id =
              ${line.id}
          and ds.authorization_item_id
              is not null
      `);

    const pool = await this.database.db.execute<{
      usable_stock_quantity: number;
      open_purchase_coverage_quantity: number;
    }>(sql`
        select
          coalesce(
            (
              select usable_quantity
              from inventory_usable_by_product
              where commercial_code =
                    ${line.commercialCode}
            ),
            0
          )::int
            as usable_stock_quantity,
          coalesce(
            (
              select open_quantity
              from purchase_open_coverage_by_product
              where commercial_code =
                    ${line.commercialCode}
            ),
            0
          )::int
            as open_purchase_coverage_quantity
      `);

    const poolRow = pool.rows[0] ?? {
      usable_stock_quantity: 0,
      open_purchase_coverage_quantity: 0,
    };

    const projection = projectFungibleAuthorizationCoverage({
      usableStockQuantity: poolRow.usable_stock_quantity,
      openPurchaseCoverageQuantity: poolRow.open_purchase_coverage_quantity,
      sources: sources.rows.map((source) => ({
        authorizationItemId: source.authorization_item_id,
        authorizationNumber: source.authorization_number,
        demandBucket: source.demand_bucket,
        quantity: source.quantity,
        assignmentDate: source.assignment_date,
        expirationDate: source.expiration_date,
      })),
    });

    const sourceById = new Map(
      sources.rows.map((source) => [source.authorization_item_id, source]),
    );

    return {
      projectedDemandLineId: line.id,
      projectedDemandRevision: line.revision,
      commercialCode: line.commercialCode,
      allocationPolicy: projection.allocationPolicy,
      physicalReservation: projection.physicalReservation,
      fungiblePool: projection.fungiblePool,
      usableStockQuantity: projection.usableStockQuantity,
      openPurchaseCoverageQuantity: projection.openPurchaseCoverageQuantity,
      totalCoveragePoolQuantity: projection.totalCoveragePoolQuantity,
      totalDemandQuantity: projection.totalDemandQuantity,
      projectedCoveredQuantity: projection.projectedCoveredQuantity,
      projectedUncoveredQuantity: projection.projectedUncoveredQuantity,
      unusedCoverageQuantity: projection.unusedCoverageQuantity,
      items: projection.items.map((item) => {
        const source = sourceById.get(item.authorizationItemId);

        return {
          authorizationItemId: item.authorizationItemId,
          authorizationNumber: item.authorizationNumber,
          patientDocument: source?.patient_document ?? null,
          patientName: source?.patient_name ?? null,
          demandBucket: item.demandBucket,
          demandQuantity: item.quantity,
          assignmentDate: item.assignmentDate,
          expirationDate: item.expirationDate,
          projectedStockCoverage: item.projectedStockCoverage,
          projectedOpenPurchaseCoverage: item.projectedOpenPurchaseCoverage,
          projectedCoveredQuantity: item.projectedCoveredQuantity,
          projectedUncoveredQuantity: item.projectedUncoveredQuantity,
          coverageStatus: item.coverageStatus,
        };
      }),
    };
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
        and dispensing_point_id is null
      for update
    `);
    // Macro 3A: la identidad viva de demanda es período + código comercial.
    // El punto deja de formar parte de la decisión de compra. Las líneas
    // históricas que todavía tienen punto quedan fuera de esta reconciliación
    // y se conservan únicamente como historia del modelo anterior.
    const existingLineByKey = new Map(existingLines.rows.map((row) => [row.commercial_code, row]));

    const existingSources = await tx.execute<ExistingSourceRow>(sql`
       select ds.projected_demand_line_id,
              ds.patient_schedule_id,
              ds.schedule_revision,
              ds.authorization_item_id,
              ds.quantity,
              ds.schedule_timing,
              ds.late_handling,
              ds.loaded_at
      from demand_sources ds
      join projected_demand_lines pdl on pdl.id = ds.projected_demand_line_id
      where pdl.planning_period_id = ${input.periodId}
        and pdl.dispensing_point_id is null
    `);
    const sourcesByLine = new Map<string, Map<string, ExistingSourceRow>>();
    for (const source of existingSources.rows) {
      const bucket =
        sourcesByLine.get(source.projected_demand_line_id) ?? new Map<string, ExistingSourceRow>();
      bucket.set(sourceKey(source), source);
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

      const pointChanged = existingLine.dispensing_point_id !== desired.dispensingPointId;

      const sourcesChanged =
        pointChanged ||
        fingerprint(desired.sources) !==
          [...currentSources.values()]
            .map(
              (source) =>
                `${sourceKey(source)}|${source.quantity}|${source.schedule_timing}|${source.late_handling}`,
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
          set dispensing_point_id = ${desired.dispensingPointId},
              regular_quantity = ${desired.regularQuantity},
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

    // Líneas vivas authorization-based que ya no tienen fuentes elegibles:
    // se eliminan junto con sus fuentes. existingLines contiene únicamente
    // dispensing_point_id IS NULL, por lo que las líneas históricas del
    // modelo basado en programación/punto nunca se eliminan aquí.
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
          (
            projected_demand_line_id,
            authorization_item_id,
            quantity,
            planning_period_id,
            dispensing_point_id,
            commercial_code,
            schedule_timing,
            late_handling,
            demand_bucket,
            loaded_at
          )
        select
          ${lineId},
          ai.id,
          ${source.quantity},
          ${periodId},
          null,
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
    const snapshotMismatch = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count
      from demand_sources ds
      join patient_schedule_history hsh
        on hsh.patient_schedule_id = ds.patient_schedule_id
       and hsh.revision = ds.schedule_revision
      where ds.patient_schedule_id is not null and ds.quantity <> hsh.quantity
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

/**
 * Identidad semántica de las fuentes que determinan la demanda.
 *
 * loadedAt se conserva como trazabilidad documental, pero no modifica
 * cantidad, autorización ni clasificación de compra; por tanto no debe
 * provocar una nueva revisión de projected_demand_lines.
 */
function fingerprint(sources: readonly DesiredSource[]): string {
  return sources
    .map(
      (source) =>
        `${sourceKey(source)}|${source.quantity}|${source.scheduleTiming}|${source.lateHandling}`,
    )
    .sort()
    .join(',');
}

function sourceKey(source: {
  patient_schedule_id?: string | null;
  schedule_revision?: number | null;
  authorization_item_id?: string | null;
  patientScheduleId?: string;
  scheduleRevision?: number;
  authorizationItemId?: string;
}): string {
  return source.patientScheduleId
    ? `${source.patientScheduleId}|${source.scheduleRevision}`
    : source.patient_schedule_id
      ? `${source.patient_schedule_id}|${source.schedule_revision}`
      : `${source.authorizationItemId ?? source.authorization_item_id}`;
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
    patientScheduleId: row.patient_schedule_id,
    scheduleRevision: row.schedule_revision,
    scheduleTiming: row.schedule_timing,
    lateHandling: row.late_handling,
    authorizationNumber: row.authorization_number,
    patientDocument: row.patient_document,
    patientName: row.patient_name,
    quantity: row.quantity,
    loadedAt: row.loaded_at,
  };
}
