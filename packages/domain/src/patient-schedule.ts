import {
  SCHEDULE_EXPIRATION_THRESHOLDS,
  patientScheduleTransitions,
  type ExpirationPriorityLevel,
  type LateHandling,
  type PatientScheduleStatus,
  type ScheduleTiming,
} from '@authorization/contracts';
import { currentBogotaDate } from './mipres';

/**
 * ESP-003: reglas puras de programación de pacientes. La programación solo
 * registra la intención de aplicar un producto autorizado (cantidad, punto y
 * fecha); no reserva inventario, no crea OC y no consolida demanda.
 */

export type ScheduleLateHandling = LateHandling;
export type ScheduleExpirationClassification = Readonly<{
  daysUntilExpiration: number | null;
  priorityLevel: ExpirationPriorityLevel | null;
}>;

export type ScheduleAuthorizationEligibilityInput = Readonly<{
  enablementStatus: string;
  coverageType: string;
  directionStatus: string;
  expirationDate: string | null;
  todayBogota: string;
}>;

export type ScheduleAuthorizationEligibility = Readonly<{
  eligible: boolean;
  code: string | null;
  message: string | null;
}>;

export class PatientScheduleTransitionError extends Error {
  readonly code = 'PATIENT_SCHEDULE_INVALID_TRANSITION';

  constructor(
    readonly from: PatientScheduleStatus,
    readonly to: PatientScheduleStatus,
  ) {
    super(`Transition ${from} -> ${to} is not allowed`);
    this.name = 'PatientScheduleTransitionError';
  }
}

export class PatientScheduleLateHandlingError extends Error {
  readonly code = 'PATIENT_SCHEDULE_LATE_HANDLING_REQUIRED';

  constructor(readonly timing: ScheduleTiming) {
    super(
      timing === 'LATE'
        ? 'LATE schedules require an explicit late handling decision'
        : 'Late handling is only allowed for LATE schedules',
    );
    this.name = 'PatientScheduleLateHandlingError';
  }
}

/**
 * Política de prioridad por vencimiento (días restantes). Se pasa explícitamente
 * a `calculateAuthorizationPriority`; el default es la política operativa
 * inicial de contratos y se conserva como valor configurable, no como regla
 * de negocio permanente del dominio.
 */
export type ScheduleExpirationPolicy = Readonly<{
  criticalDays: number;
  highDays: number;
}>;

/** Fecha calendario America/Bogota; el dominio nunca usa la zona local del host. */
export function scheduleToday(now: Date = new Date()): string {
  return currentBogotaDate(now);
}

/**
 * Normaliza la fecha de vencimiento de la autorización. Acepta el formato
 * compacto del archivo fuente (YYYYMMDD) y el ISO (YYYY-MM-DD). Devuelve null
 * cuando el valor no es interpretable.
 */
export function parseAuthorizationExpiration(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return currentBogotaDate(parsed);
}

/**
 * Prioridad visual por proximidad del vencimiento. La política es un parámetro
 * explícito con default sobre `SCHEDULE_EXPIRATION_THRESHOLDS` (contratos):
 * única fuente compartida API/Web. La clasificación no decide ni reserva
 * nada: es una alerta operacional para Medicarte.
 */
export function calculateAuthorizationPriority(
  authorizationExpirationDate: string | null,
  todayBogota: string,
  policy: ScheduleExpirationPolicy = SCHEDULE_EXPIRATION_THRESHOLDS,
): ScheduleExpirationClassification {
  if (!authorizationExpirationDate) {
    return { daysUntilExpiration: null, priorityLevel: null };
  }
  const daysUntilExpiration = daysBetween(todayBogota, authorizationExpirationDate);
  const priorityLevel: ExpirationPriorityLevel =
    daysUntilExpiration <= policy.criticalDays
      ? 'CRITICAL'
      : daysUntilExpiration <= policy.highDays
        ? 'HIGH'
        : 'NORMAL';
  return { daysUntilExpiration, priorityLevel };
}

/**
 * Habilitación operativa para programar según las reglas clínicas actuales.
 * No evalúa tarifario ni inventario: eso corresponde a otros módulos.
 */
export function evaluateScheduleAuthorizationEligibility(
  input: ScheduleAuthorizationEligibilityInput,
): ScheduleAuthorizationEligibility {
  if (input.enablementStatus !== 'ENABLED') {
    return {
      eligible: false,
      code: 'AUTHORIZATION_NOT_SCHEDULABLE',
      message: 'The authorization is not enabled for scheduling',
    };
  }
  if (input.expirationDate !== null && input.todayBogota > input.expirationDate) {
    return {
      eligible: false,
      code: 'AUTHORIZATION_EXPIRED',
      message: 'The authorization expired before the scheduling date',
    };
  }
  if (input.coverageType === 'PBS' && input.directionStatus !== 'NOT_APPLICABLE') {
    return {
      eligible: false,
      code: 'AUTHORIZATION_NOT_SCHEDULABLE',
      message: 'PBS authorizations must not require MIPRES direction',
    };
  }
  if (input.coverageType === 'NO_PBS' && input.directionStatus !== 'CONFIRMED') {
    return {
      eligible: false,
      code: 'AUTHORIZATION_NOT_SCHEDULABLE',
      message: 'NO_PBS authorizations require a confirmed MIPRES direction',
    };
  }
  return { eligible: true, code: null, message: null };
}

export function canTransitionPatientSchedule(
  from: PatientScheduleStatus,
  to: PatientScheduleStatus,
): boolean {
  return patientScheduleTransitions[from].includes(to);
}

export function assertPatientScheduleTransition(
  from: PatientScheduleStatus,
  to: PatientScheduleStatus,
): void {
  if (!canTransitionPatientSchedule(from, to)) {
    throw new PatientScheduleTransitionError(from, to);
  }
}

export function requiresLateHandling(timing: ScheduleTiming): boolean {
  return timing === 'LATE';
}

/**
 * LATE exige decisión explícita (OC complementaria o siguiente período);
 * ON_TIME no admite `lateHandling`.
 */
export function assertLateHandling(
  timing: ScheduleTiming,
  lateHandling: LateHandling | null | undefined,
): void {
  const hasHandling = lateHandling !== null && lateHandling !== undefined;
  if (timing === 'LATE' && !hasHandling) throw new PatientScheduleLateHandlingError(timing);
  if (timing === 'ON_TIME' && hasHandling) throw new PatientScheduleLateHandlingError(timing);
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    Number(fromIso.slice(0, 4)),
    Number(fromIso.slice(5, 7)) - 1,
    Number(fromIso.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toIso.slice(0, 4)),
    Number(toIso.slice(5, 7)) - 1,
    Number(toIso.slice(8, 10)),
  );
  return Math.round((to - from) / 86_400_000);
}
