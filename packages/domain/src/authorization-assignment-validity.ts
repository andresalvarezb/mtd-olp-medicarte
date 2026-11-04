import { normalizeAuthorizationOperationalDate } from './authorization-operational-window';
import { evaluateAuthorizationFulfillmentWindow } from './authorization-fulfillment-window';

export type AuthorizationAssignmentValidityStatus =
  | 'VIGENTE'
  | 'NO VIGENTE';

export type AuthorizationAssignmentValidityReason =
  | 'VALID'
  | 'INVALID_ASSIGNMENT_DATE'
  | 'INVALID_EXPIRATION_DATE'
  | 'EXPIRED'
  | 'ASSIGNMENT_OUTSIDE_WINDOW';

export type AuthorizationAssignmentValidity = Readonly<{
  eligible: boolean;
  status: AuthorizationAssignmentValidityStatus;
  reason: AuthorizationAssignmentValidityReason;
  assignmentDate: string | null;
  expirationDate: string | null;
  managementMonth: string | null;
}>;

function normalizedDate(value: unknown): string | null {
  return typeof value === 'string'
    ? normalizeAuthorizationOperationalDate(value)
    : null;
}

function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function datePlusDays(value: string, days: number): string {
  const instant = new Date(`${value}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/**
 * Vigencia temporal para seleccionar una autorización como destino de OC.
 * Las fechas recibidas pueden venir como YYYYMMDD, YYYY-MM-DD o un timestamp
 * con prefijo ISO; el cálculo siempre compara fechas calendario de Bogotá.
 */
export function evaluateAuthorizationAssignmentValidity(input: Readonly<{
  assignmentDate: unknown;
  expirationDate: unknown;
  todayBogota: string;
}>): AuthorizationAssignmentValidity {
  if (!isStrictIsoDate(input.todayBogota)) {
    throw new Error('INVALID_BOGOTA_DATE');
  }

  const assignmentDate = normalizedDate(input.assignmentDate);
  const expirationDate = normalizedDate(input.expirationDate);
  const managementMonth = assignmentDate?.slice(0, 7) ?? null;

  const invalid = (
    reason: AuthorizationAssignmentValidityReason,
  ): AuthorizationAssignmentValidity => ({
    eligible: false,
    status: 'NO VIGENTE',
    reason,
    assignmentDate,
    expirationDate,
    managementMonth,
  });

  if (!assignmentDate) return invalid('INVALID_ASSIGNMENT_DATE');
  if (!expirationDate) return invalid('INVALID_EXPIRATION_DATE');

  const fulfillmentWindow = evaluateAuthorizationFulfillmentWindow({
    expirationDate,
    todayBogota: input.todayBogota,
    hasConfirmedAttention: false,
    remainingAuthorizedQuantity: 1,
  });

  // Una nueva relación comercial solo puede crearse durante la vigencia o
  // los cinco días de gracia. Vínculos ya activos se conservan por su propio
  // historial y el worker decide su liberación con evidencia de atención.
  const expirationInCurrentMonth =
    expirationDate.slice(0, 7) === input.todayBogota.slice(0, 7) &&
    fulfillmentWindow.eligibleForNewReservation;
  if (!expirationInCurrentMonth && expirationDate < input.todayBogota) {
    return invalid('EXPIRED');
  }

  const sameManagementMonth = assignmentDate.slice(0, 7) === input.todayBogota.slice(0, 7);
  const insideForwardWindow =
    assignmentDate >= input.todayBogota &&
    assignmentDate <= datePlusDays(input.todayBogota, 20);

  if (!expirationInCurrentMonth && !sameManagementMonth && !insideForwardWindow) {
    return invalid('ASSIGNMENT_OUTSIDE_WINDOW');
  }

  return {
    eligible: true,
    status: 'VIGENTE',
    reason: 'VALID',
    assignmentDate,
    expirationDate,
    managementMonth,
  };
}
