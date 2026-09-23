export const AUTHORIZATION_FULFILLMENT_TYPES = [
  'APPLICATION',
  'DELIVERY',
] as const;

export type AuthorizationFulfillmentType =
  (typeof AUTHORIZATION_FULFILLMENT_TYPES)[number];

export type AuthorizationFulfillmentInput = Readonly<{
  effectiveDate: string;
  validityEndDate: string | null;
  todayBogota: string;
  assignedQuantity: number;
  pointCount: number;
  alreadyClosed: boolean;
}>;

export class AuthorizationFulfillmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthorizationFulfillmentError';
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function assertAuthorizationFulfillment(
  input: AuthorizationFulfillmentInput,
): void {
  if (!isIsoDate(input.effectiveDate)) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_DATE_INVALID',
      'La fecha efectiva no es válida.',
    );
  }

  if (!isIsoDate(input.todayBogota)) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_TODAY_INVALID',
      'La fecha operacional no es válida.',
    );
  }

  if (
    input.validityEndDate === null ||
    !isIsoDate(input.validityEndDate)
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_EXPIRATION_UNAVAILABLE',
      'No se pudo determinar la fecha final de vigencia de la autorización.',
    );
  }

  if (input.alreadyClosed) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_ALREADY_CLOSED',
      'La autorización ya se encuentra cerrada operacionalmente.',
    );
  }

  if (input.assignedQuantity <= 0) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_ALLOCATION_REQUIRED',
      'La autorización no tiene inventario asignado pendiente de consumo.',
    );
  }

  if (input.pointCount !== 1) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_POINT_AMBIGUOUS',
      'La autorización debe resolver exactamente un punto de dispensación.',
    );
  }

  /*
   * Es un evento ya ocurrido.
   * Puede registrarse después del vencimiento de la AUTO,
   * pero no puede declararse una fecha futura.
   */
  if (input.effectiveDate > input.todayBogota) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_FUTURE_DATE',
      'La fecha de entrega o aplicación no puede ser futura.',
    );
  }

  /*
   * Regla de negocio crítica:
   *
   * NO importa que hoy la autorización esté vencida.
   * La fecha efectiva sí debe ser <= fecha final de vigencia.
   */
  if (input.effectiveDate > input.validityEndDate) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_AFTER_EXPIRATION',
      'La fecha de entrega o aplicación supera la vigencia de la autorización.',
    );
  }
}
