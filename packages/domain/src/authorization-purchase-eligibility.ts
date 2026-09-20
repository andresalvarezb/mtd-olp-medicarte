const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isStrictIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;

  const instant = new Date(`${value}T00:00:00Z`);

  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

export type AuthorizationPurchaseEligibilityReason =
  | 'ELIGIBLE'
  | 'SOURCE_STATUS_BLOCKED'
  | 'ASSIGNMENT_DATE_INVALID'
  | 'EXPIRATION_DATE_INVALID'
  | 'FUTURE_VIGENCY'
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
 * Regla temporal canónica de elegibilidad para compra.
 *
 * Una AUTO puede participar durante el mes actual cuando:
 * - ESTADO_AUTORIZACION = 5;
 * - FECHA_ASIGNACION es válida y no pertenece a un mes futuro;
 * - FECHA_FINAL_VIGENCIA es válida y no está vencida.
 *
 * La fecha de asignación puede ser posterior a "hoy" siempre que pertenezca
 * al mismo mes operativo. Ejemplo: el 19 de septiembre una AUTO que inicia
 * el 25 de septiembre puede participar.
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

  if (!isStrictIsoDate(input.assignmentDate)) {
    return {
      eligible: false,
      reason: 'ASSIGNMENT_DATE_INVALID',
      currentMonthEnd,
    };
  }

  if (!isStrictIsoDate(input.expirationDate)) {
    return {
      eligible: false,
      reason: 'EXPIRATION_DATE_INVALID',
      currentMonthEnd,
    };
  }

  if (input.expirationDate < input.todayBogota) {
    return {
      eligible: false,
      reason: 'EXPIRED',
      currentMonthEnd,
    };
  }

  if (input.assignmentDate > currentMonthEnd) {
    return {
      eligible: false,
      reason: 'FUTURE_VIGENCY',
      currentMonthEnd,
    };
  }

  return {
    eligible: true,
    reason: 'ELIGIBLE',
    currentMonthEnd,
  };
}
