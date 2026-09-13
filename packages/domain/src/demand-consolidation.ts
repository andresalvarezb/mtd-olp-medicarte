import type { LateHandling, ScheduleTiming } from '@authorization/contracts';

/**
 * ESP-004: resolución explícita del período efectivo y del bucket de demanda
 * de una programación para la consolidación. Es la ÚNICA regla que decide a
 * qué período aporta y con qué bucket; no se duplica en SQL, API ni frontend.
 *
 * Reglas definitivas (invariante de negocio):
 * - ON_TIME → effectivePeriod = planning_period_id, bucket REGULAR.
 * - LATE + COMPLEMENTARY_PURCHASE_ORDER → effectivePeriod =
 *   planning_period_id, bucket LATE (la OC complementaria se materializa
 *   sobre ese período en ESP-005).
 * - LATE + NEXT_PERIOD → effectivePeriod = deferred_planning_period_id,
 *   bucket REGULAR (la programación se difirió; el schedule_timing LATE y el
 *   late_handling NEXT_PERIOD permanecen en demand_sources como hecho
 *   histórico de la programación original).
 * - LATE + NEXT_PERIOD sin período diferido es una inconsistencia imposible
 *   (ESP-003 nunca lo persiste así) y falla de forma explícita, sin
 *   deduplicación silenciosa.
 */
export type DemandSourceClassification = 'REGULAR' | 'LATE';

export type EffectiveSchedulePeriod = Readonly<{
  effectivePeriodId: string;
  classification: DemandSourceClassification;
}>;

export class DemandConsolidationError extends Error {
  readonly code = 'PROJECTED_DEMAND_INCONSISTENT_SCHEDULE';

  constructor(
    readonly patientScheduleId: string,
    message: string,
  ) {
    super(message);
    this.name = 'DemandConsolidationError';
  }
}

export type EffectiveSchedulePeriodInput = Readonly<{
  scheduleTiming: ScheduleTiming;
  lateHandling: LateHandling | null;
  planningPeriodId: string;
  deferredPlanningPeriodId: string | null;
}>;

export function resolveEffectiveSchedulePeriod(
  input: EffectiveSchedulePeriodInput,
): Readonly<{ effectivePeriodId: string; classification: DemandSourceClassification }> {
  if (input.scheduleTiming === 'ON_TIME') {
    return { effectivePeriodId: input.planningPeriodId, classification: 'REGULAR' };
  }
  if (input.lateHandling === 'COMPLEMENTARY_PURCHASE_ORDER') {
    return { effectivePeriodId: input.planningPeriodId, classification: 'LATE' };
  }
  if (input.lateHandling === 'NEXT_PERIOD') {
    if (!input.deferredPlanningPeriodId) {
      throw new DemandConsolidationError(
        'unknown-schedule',
        'LATE + NEXT_PERIOD schedule has no deferred planning period',
      );
    }
    // Semántica definitiva: la programación diferienda llega como REGULAR a
    // su período efectivo; el LATE histórico queda en los snapshots.
    return { effectivePeriodId: input.deferredPlanningPeriodId, classification: 'REGULAR' };
  }
  // lateHandling nulo con timing LATE: viola la coherencia de ESP-003.
  throw new Error('LATE schedule without late_handling is inconsistent');
}

/**
 * Sumas de línea a partir de fuentes ya clasificadas por bucket. La
 * invariante agregada (projected = regular + late) se verifica
 * transaccionalmente en el repositorio; esta función es la única definición
 * de las sumas. `originScheduleTiming` queda documental y NO participa en
 * la sumas: el bucket se resuelve con la regla del dominio.
 */
export function sumDemandQuantities(
  sources: ReadonlyArray<{
    quantity: number;
    classification: DemandSourceClassification;
    originScheduleTiming?: ScheduleTiming;
  }>,
): Readonly<{ regularQuantity: number; lateQuantity: number; projectedQuantity: number }> {
  let regularQuantity = 0;
  let lateQuantity = 0;
  for (const source of sources) {
    if (source.classification === 'REGULAR') {
      regularQuantity += source.quantity;
    } else {
      lateQuantity += source.quantity;
    }
  }
  return { regularQuantity, lateQuantity, projectedQuantity: regularQuantity + lateQuantity };
}
