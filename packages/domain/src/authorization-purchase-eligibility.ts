import { evaluateAuthorizationAssignmentValidity } from './authorization-assignment-validity';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isStrictIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

export type AuthorizationPurchaseEligibilityReason =
  | 'ELIGIBLE'
  | 'SOURCE_STATUS_BLOCKED'
  | 'ASSIGNMENT_DATE_INVALID'
  | 'EXPIRATION_DATE_INVALID'
  | 'ASSIGNMENT_OUTSIDE_WINDOW'
  | 'EXPIRED';

export type AuthorizationPurchaseEligibilityInput = Readonly<{
  sourceStatus: unknown;
  assignmentDate: string;
  expirationDate: string;
  todayBogota: string;
}>;

export type AuthorizationPurchaseEligibility = Readonly<{
  eligible: boolean;
  reason: AuthorizationPurchaseEligibilityReason;
  currentMonthEnd: string;
}>;

/**
 * ESTADO_AUTORIZACION=5 es el único estado fuente habilitante.
 *
 * Otros valores se conservan como evidencia de la AUTO, pero no habilitan
 * demanda ni compra.
 */
export function isAuthorizationSourceEnabled(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return false;
  }

  return String(value).trim() === '5';
}

/**
 * Devuelve el último día del mes operativo correspondiente a una fecha
 * calendario America/Bogota expresada como YYYY-MM-DD.
 */
export function authorizationPurchaseMonthEnd(todayBogota: string): string {
  if (!isStrictIsoDate(todayBogota)) {
    throw new Error('INVALID_BOGOTA_DATE');
  }

  const [yearText, monthText] = todayBogota.split('-');
  const year = Number(yearText);
  const month = Number(monthText);

  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Regla canónica de elegibilidad de una AUTO destino para compra.
 *
 * Una AUTO puede participar dentro de la ventana operacional cuando:
 * - ESTADO_AUTORIZACION = 5;
 * - FECHA_ASIGNACION pertenece al mes calendario actual o cae entre hoy y
 *   hoy + 20 días;
 * - FECHA_FINAL_VIGENCIA es hoy o posterior.
 *
 * La presencia en AT y clasificación PBS se verifican en la frontera
 * correspondiente porque dependen del estado persistido del Anexo Tarifario.
 */
export function evaluateAuthorizationPurchaseEligibility(
  input: AuthorizationPurchaseEligibilityInput,
): AuthorizationPurchaseEligibility {
  const currentMonthEnd = authorizationPurchaseMonthEnd(input.todayBogota);

  if (!isAuthorizationSourceEnabled(input.sourceStatus)) {
    return {
      eligible: false,
      reason: 'SOURCE_STATUS_BLOCKED',
      currentMonthEnd,
    };
  }

  const validity = evaluateAuthorizationAssignmentValidity(input);
  let reason: AuthorizationPurchaseEligibilityReason;

  if (validity.eligible) {
    reason = 'ELIGIBLE';
  } else if (validity.reason === 'INVALID_ASSIGNMENT_DATE') {
    reason = 'ASSIGNMENT_DATE_INVALID';
  } else if (validity.reason === 'INVALID_EXPIRATION_DATE') {
    reason = 'EXPIRATION_DATE_INVALID';
  } else if (validity.reason === 'VALID') {
    reason = 'ELIGIBLE';
  } else {
    reason = validity.reason;
  }

  return {
    eligible: validity.eligible,
    reason,
    currentMonthEnd,
  };
}
