import {
  evaluateAuthorizationOperationalWindow,
  type AuthorizationOperationalWindowStatus,
} from '@authorization/domain';

export type AuthorizationQueryValidityStatus = AuthorizationOperationalWindowStatus;

export type AuthorizationQueryFulfillmentStatus = 'PENDING' | 'DELIVERED' | 'APPLIED';

export type AuthorizationQueryInitialValidationStatus =
  | 'PASSED'
  | 'PENDING'
  | 'FAILED';

export type AuthorizationQueryAuditStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export type AuthorizationQueryLifecycleStatus =
  | 'ENABLED'
  | 'PENDING'
  | 'DISABLED';

export function resolveAuthorizationLifecycleStatus(
  input: Readonly<{
    initialValidationStatus:
      AuthorizationQueryInitialValidationStatus;

    validityStatus:
      AuthorizationQueryValidityStatus;
  }>,
): AuthorizationQueryLifecycleStatus {
  /*
   * Precedencia funcional:
   *
   * 1. Bloqueo definitivo.
   * 2. Pendiente resoluble / fuera de horizonte.
   * 3. Habilitada.
   *
   * Una relación histórica con OC no participa
   * de esta decisión.
   */
  if (
    input.initialValidationStatus === 'FAILED'
    ||
    input.validityStatus === 'INVALID_DATE'
    ||
    input.validityStatus === 'EXPIRED'
  ) {
    return 'DISABLED';
  }

  if (
    input.initialValidationStatus === 'PENDING'
    ||
    input.validityStatus === 'OUTSIDE_HORIZON'
  ) {
    return 'PENDING';
  }

  return 'ENABLED';
}

export type AuthorizationQueryLifecycleReasonCode =
  | 'SOURCE_STATUS_BLOCKED'
  | 'PRODUCT_NOT_IN_TARIFF'
  | 'INVALID_QUANTITY'
  | 'INVALID_MINIMUM_QUANTITY'
  | 'BELOW_MINIMUM_QUANTITY'
  | 'INVALID_DATE'
  | 'EXPIRED'
  | 'TARIFF_VALIDATION_PENDING'
  | 'DIRECTION_PENDING'
  | 'COVERAGE_PENDING'
  | 'OUTSIDE_HORIZON';


export type AuthorizationQueryLifecycleReason =
  Readonly<{
    code:
      AuthorizationQueryLifecycleReasonCode;

    message:
      string;
  }>;


export function resolveAuthorizationLifecycleReasons(
  input: Readonly<{
    lifecycleStatus:
      AuthorizationQueryLifecycleStatus;

    enablementStatus:
      string | null | undefined;

    tariffMembershipStatus:
      string | null | undefined;

    coverageType:
      string | null | undefined;

    directionStatus:
      string | null | undefined;

    quantity?:
      string | number | null;

    minimumQuantity?:
      number | null;

    validityStatus:
      AuthorizationQueryValidityStatus;
  }>,
): AuthorizationQueryLifecycleReason[] {
  /*
   * HABILITADA no requiere explicación operativa.
   */
  if (
    input.lifecycleStatus ===
      'ENABLED'
  ) {
    return [];
  }


  const definitive:
    AuthorizationQueryLifecycleReason[] =
      [];


  if (
    input.enablementStatus !==
      'ENABLED'
  ) {
    definitive.push({
      code:
        'SOURCE_STATUS_BLOCKED',

      message:
        'Estado fuente de la autorización no habilitante',
    });
  }


  if (
    input.tariffMembershipStatus ===
      'NOT_LISTED'
  ) {
    definitive.push({
      code:
        'PRODUCT_NOT_IN_TARIFF',

      message:
        'Producto no listado/activo en Anexo Tarifario',
    });
  }


  if (
    input.quantity !==
      undefined
    ||
    input.minimumQuantity !==
      undefined
  ) {
    const quantity =
      Number(
        input.quantity,
      );

    const minimumQuantity =
      Number(
        input.minimumQuantity
        ??
        1,
      );


    const validQuantity =
      Number.isInteger(
        quantity,
      )
      &&
      quantity >
        0;

    const validMinimum =
      Number.isInteger(
        minimumQuantity,
      )
      &&
      minimumQuantity >
        0;


    if (
      !validQuantity
    ) {
      definitive.push({
        code:
          'INVALID_QUANTITY',

        message:
          'Cantidad autorizada inválida',
      });
    }


    if (
      !validMinimum
    ) {
      definitive.push({
        code:
          'INVALID_MINIMUM_QUANTITY',

        message:
          'Cantidad mínima del Anexo Tarifario inválida',
      });
    }


    if (
      validQuantity
      &&
      validMinimum
      &&
      quantity <
        minimumQuantity
    ) {
      definitive.push({
        code:
          'BELOW_MINIMUM_QUANTITY',

        message:
          `Cantidad autorizada ${quantity} inferior a la cantidad mínima ${minimumQuantity} del Anexo Tarifario`,
      });
    }
  }


  if (
    input.validityStatus ===
      'INVALID_DATE'
  ) {
    definitive.push({
      code:
        'INVALID_DATE',

      message:
        'Fecha de asignación o vigencia inválida',
    });
  }


  if (
    input.validityStatus ===
      'EXPIRED'
  ) {
    definitive.push({
      code:
        'EXPIRED',

      message:
        'Fecha final de vigencia vencida',
    });
  }


  /*
   * Si la Habilitación consolidada es INHABILITADA,
   * solamente se exponen bloqueos definitivos.
   *
   * No mezclamos advertencias pendientes con causas
   * definitivas porque confundiría el reporte.
   */
  if (
    input.lifecycleStatus ===
      'DISABLED'
  ) {
    return definitive;
  }


  const pending:
    AuthorizationQueryLifecycleReason[] =
      [];


  if (
    input.tariffMembershipStatus !==
      'LISTED'
    &&
    input.tariffMembershipStatus !==
      'NOT_LISTED'
  ) {
    pending.push({
      code:
        'TARIFF_VALIDATION_PENDING',

      message:
        'Validación del producto en Anexo Tarifario pendiente',
    });
  }


  if (
    input.coverageType ===
      'NO_PBS'
    &&
    input.directionStatus !==
      'CONFIRMED'
  ) {
    pending.push({
      code:
        'DIRECTION_PENDING',

      message:
        'Direccionamiento NO PBS pendiente',
    });
  }


  if (
    input.coverageType ===
      'PBS'
    &&
    input.directionStatus !==
      'NOT_APPLICABLE'
  ) {
    pending.push({
      code:
        'DIRECTION_PENDING',

      message:
        'Validación de direccionamiento pendiente',
    });
  }


  if (
    input.coverageType !==
      'PBS'
    &&
    input.coverageType !==
      'NO_PBS'
  ) {
    pending.push({
      code:
        'COVERAGE_PENDING',

      message:
        'Cobertura pendiente de validación',
    });
  }


  if (
    input.validityStatus ===
      'OUTSIDE_HORIZON'
  ) {
    pending.push({
      code:
        'OUTSIDE_HORIZON',

      message:
        'Fecha de asignación fuera de la ventana operativa de 30 días',
    });
  }


  return pending;
}


export function resolveAuthorizationValidityStatus(
  input: Readonly<{
    assignmentDate: string | null | undefined;

    validityEndDate: string | null | undefined;

    today: string;
  }>,
): AuthorizationQueryValidityStatus {
  return evaluateAuthorizationOperationalWindow({
    assignmentDate: input.assignmentDate,

    expirationDate: input.validityEndDate,

    todayBogota: input.today,
  }).status;
}

export function resolveAuthorizationInitialValidationStatus(
  input: Readonly<{
    enablementStatus: string | null | undefined;
    tariffMembershipStatus: string | null | undefined;
    coverageType: string | null | undefined;
    directionStatus: string | null | undefined;
    quantity?: string | number | null;
    minimumQuantity?: number | null;
  }>,
): AuthorizationQueryInitialValidationStatus {
  if (input.enablementStatus !== 'ENABLED') {
    return 'FAILED';
  }

  if (input.tariffMembershipStatus === 'NOT_LISTED') {
    return 'FAILED';
  }

  if (input.tariffMembershipStatus !== 'LISTED') {
    return 'PENDING';
  }

  if (
    input.quantity !== undefined ||
    input.minimumQuantity !== undefined
  ) {
    const quantity =
      Number(
        input.quantity,
      );

    const minimumQuantity =
      Number(
        input.minimumQuantity ??
        1,
      );

    if (
      !Number.isInteger(
        quantity,
      ) ||
      quantity <=
        0 ||
      !Number.isInteger(
        minimumQuantity,
      ) ||
      minimumQuantity <=
        0 ||
      quantity <
        minimumQuantity
    ) {
      return 'FAILED';
    }
  }

  if (input.coverageType === 'PBS') {
    return input.directionStatus === 'NOT_APPLICABLE'
      ? 'PASSED'
      : 'PENDING';
  }

  if (input.coverageType === 'NO_PBS') {
    return input.directionStatus === 'CONFIRMED'
      ? 'PASSED'
      : 'PENDING';
  }

  return 'PENDING';
}

export function resolveAuthorizationFulfillmentStatus(
  fulfillmentType: string | null | undefined,
): AuthorizationQueryFulfillmentStatus {
  if (fulfillmentType === 'APPLICATION') {
    return 'APPLIED';
  }

  if (fulfillmentType === 'DELIVERY') {
    return 'DELIVERED';
  }

  return 'PENDING';
}

export function resolveAuthorizationAuditStatus(
  auditStatus: string | null | undefined,
): AuthorizationQueryAuditStatus {
  if (auditStatus === 'APPROVED') {
    return 'APPROVED';
  }

  if (auditStatus === 'REJECTED') {
    return 'REJECTED';
  }

  if (auditStatus === 'IN_REVIEW') {
    return 'IN_REVIEW';
  }

  return 'PENDING';
}
