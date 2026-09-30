export const AUTHORIZATION_FULFILLMENT_TYPES = [
  'APPLICATION',
  'DELIVERY',
] as const;

export type AuthorizationFulfillmentType =
  (typeof AUTHORIZATION_FULFILLMENT_TYPES)[number];

export type AuthorizationFulfillmentInput =
  Readonly<{
    effectiveDate: string;
    validityEndDate: string | null;
    todayBogota: string;

    requestedQuantity: number;

    remainingAuthorizedQuantity: number;

    assignedQuantity: number;

    pointCount: number;

    alreadyClosed: boolean;
  }>;


export class AuthorizationFulfillmentError
  extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);

    this.name =
      'AuthorizationFulfillmentError';
  }
}


function isIsoDate(
  value: string,
): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value,
    )
  ) {
    return false;
  }

  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  return (
    !Number.isNaN(
      date.getTime(),
    )
    &&
    date
      .toISOString()
      .slice(
        0,
        10,
      ) ===
      value
  );
}


export function assertAuthorizationFulfillment(
  input:
    AuthorizationFulfillmentInput,
): void {
  if (
    !isIsoDate(
      input.effectiveDate,
    )
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_DATE_INVALID',
      'La fecha efectiva no es válida.',
    );
  }


  if (
    !isIsoDate(
      input.todayBogota,
    )
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_TODAY_INVALID',
      'La fecha operacional no es válida.',
    );
  }


  if (
    input.validityEndDate ===
      null
    ||
    !isIsoDate(
      input.validityEndDate,
    )
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_EXPIRATION_UNAVAILABLE',
      'No se pudo determinar la fecha final de vigencia de la autorización.',
    );
  }


  if (
    input.alreadyClosed
    ||
    input.remainingAuthorizedQuantity <=
      0
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_ALREADY_CLOSED',
      'La autorización ya se encuentra atendida completamente.',
    );
  }


  if (
    !Number.isInteger(
      input.requestedQuantity,
    )
    ||
    input.requestedQuantity <=
      0
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_QUANTITY_INVALID',
      'La cantidad a entregar o aplicar debe ser un entero positivo.',
    );
  }


  if (
    input.requestedQuantity >
      input.remainingAuthorizedQuantity
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_QUANTITY_EXCEEDS_REMAINING_AUTHORIZED',
      'La cantidad supera el saldo pendiente de la autorización.',
    );
  }


  if (
    input.assignedQuantity <=
      0
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_ALLOCATION_REQUIRED',
      'La autorización no tiene inventario asignado pendiente de consumo.',
    );
  }


  if (
    input.requestedQuantity >
      input.assignedQuantity
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_QUANTITY_EXCEEDS_ASSIGNED',
      'La cantidad supera el saldo de producto asignado disponible.',
    );
  }


  if (
    input.pointCount !==
      1
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_POINT_AMBIGUOUS',
      'La autorización debe resolver exactamente un punto de dispensación.',
    );
  }


  /*
   * EXPIRED es informativo.
   *
   * La fecha efectiva puede ser posterior al
   * vencimiento de la AUTO.
   *
   * La única cota temporal es HOY:
   * no se admite declarar un evento futuro.
   */
  if (
    input.effectiveDate >
      input.todayBogota
  ) {
    throw new AuthorizationFulfillmentError(
      'AUTHORIZATION_FULFILLMENT_FUTURE_DATE',
      'La fecha de entrega o aplicación no puede ser futura.',
    );
  }
}
