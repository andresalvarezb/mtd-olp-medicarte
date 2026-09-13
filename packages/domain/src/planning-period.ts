import { planningPeriodTransitions, type PlanningPeriodStatus } from '@authorization/contracts';

/**
 * ESP-002: reglas puras de períodos de planificación. El scope de los períodos
 * es global (un único calendario operativo compartido por MTD, OLP y
 * Medicarte); la segmentación por organización se aplica sobre RBAC, no sobre
 * la identidad del período.
 */

export type PlanningPeriodDates = Readonly<{
  startDate: string;
  endDate: string;
  schedulingCutoffAt: Date | string;
  purchaseOrderDeadlineAt: Date | string;
  expectedDeliveryDate: string;
}>;

export type PlanningPeriodValidationIssue = Readonly<{
  field: string;
  code: string;
  message: string;
}>;

export const PLANNING_PERIOD_STRUCTURAL_FIELDS = ['startDate', 'endDate'] as const;
export type PlanningPeriodStructuralField = (typeof PLANNING_PERIOD_STRUCTURAL_FIELDS)[number];

export type PlanningPeriodTiming = 'ON_TIME' | 'LATE';

export class PlanningPeriodTransitionError extends Error {
  readonly code = 'PLANNING_PERIOD_INVALID_TRANSITION';

  constructor(
    readonly from: PlanningPeriodStatus,
    readonly to: PlanningPeriodStatus,
  ) {
    super(`Transition ${from} -> ${to} is not allowed`);
    this.name = 'PlanningPeriodTransitionError';
  }
}

export class PlanningPeriodStructuralError extends Error {
  readonly code = 'PLANNING_PERIOD_STRUCTURAL_FROZEN';

  constructor(readonly fields: readonly string[]) {
    super(`Structural fields are frozen: ${fields.join(', ')}`);
    this.name = 'PlanningPeriodStructuralError';
  }
}

/** Fecha calendario America/Bogota para un instante dado, en ISO YYYY-MM-DD. */
export function bogotaDateOf(instant: Date | string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Valida la coherencia de fechas del período. La comparación entre el límite
 * de OC (timestamptz) y la entrega esperada (date) usa la fecha calendario de
 * America/Bogota.
 */
export function validatePlanningPeriodDates(
  input: PlanningPeriodDates,
): PlanningPeriodValidationIssue[] {
  const issues: PlanningPeriodValidationIssue[] = [];
  if (input.startDate > input.endDate) {
    issues.push({
      field: 'startDate',
      code: 'PLANNING_PERIOD_INVALID_RANGE',
      message: 'start_date must be less than or equal to end_date',
    });
  }
  const cutoff = toInstant(input.schedulingCutoffAt);
  const purchaseDeadline = toInstant(input.purchaseOrderDeadlineAt);
  if (cutoff.getTime() > purchaseDeadline.getTime()) {
    issues.push({
      field: 'schedulingCutoffAt',
      code: 'PLANNING_PERIOD_INVALID_DEADLINE_ORDER',
      message: 'scheduling_cutoff_at must be less than or equal to purchase_order_deadline_at',
    });
  }
  if (bogotaDateOf(purchaseDeadline) > input.expectedDeliveryDate) {
    issues.push({
      field: 'expectedDeliveryDate',
      code: 'PLANNING_PERIOD_DELIVERY_BEFORE_DEADLINE',
      message: 'purchase_order_deadline_at must not be after expected_delivery_date',
    });
  }
  return issues;
}

/**
 * Clasifica una programación frente al corte del período. La decisión es
 * puramente temporal: hasta el corte inclusive es ON_TIME; después, LATE.
 */
export function classifyScheduleTiming(
  period: Pick<PlanningPeriodDates, 'schedulingCutoffAt'>,
  timestamp: Date | string,
): PlanningPeriodTiming {
  const cutoff = toInstant(period.schedulingCutoffAt);
  const instant = toInstant(timestamp);
  return instant.getTime() <= cutoff.getTime() ? 'ON_TIME' : 'LATE';
}

export function canTransitionPlanningPeriod(
  from: PlanningPeriodStatus,
  to: PlanningPeriodStatus,
): boolean {
  return planningPeriodTransitions[from].includes(to);
}

export function assertPlanningPeriodTransition(
  from: PlanningPeriodStatus,
  to: PlanningPeriodStatus,
): void {
  if (!canTransitionPlanningPeriod(from, to)) {
    throw new PlanningPeriodTransitionError(from, to);
  }
}

/**
 * Las fechas del rango son editables solo mientras el período está en
 * OPEN o PLANNING_CLOSED. A partir de PURCHASING quedan congeladas.
 */
export function isPlanningPeriodStructurallyEditable(status: PlanningPeriodStatus): boolean {
  return status === 'OPEN' || status === 'PLANNING_CLOSED';
}

export function assertStructuralEditAllowed(
  status: PlanningPeriodStatus,
  changedFields: readonly string[],
): void {
  const structural = changedFields.filter((field) =>
    (PLANNING_PERIOD_STRUCTURAL_FIELDS as readonly string[]).includes(field),
  );
  if (structural.length > 0 && !isPlanningPeriodStructurallyEditable(status)) {
    throw new PlanningPeriodStructuralError(structural);
  }
}

function toInstant(value: Date | string): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  return date;
}
