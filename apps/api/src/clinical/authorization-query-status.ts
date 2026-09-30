export type AuthorizationOperationalStatus =
  | 'UNASSIGNED'
  | 'PARTIALLY_ASSIGNED'
  | 'ASSIGNED'
  | 'OUT_OF_OPERATION'
  | 'CLOSED';


export type AuthorizationFulfillmentProgressStatus =
  | 'PENDING'
  | 'PARTIAL'
  | 'COMPLETE';


export function resolveAuthorizationFulfillmentProgressStatus(
  input: Readonly<{
    authorizedQuantity: number;
    fulfilledQuantity: number;
  }>,
): AuthorizationFulfillmentProgressStatus {
  const authorized =
    Math.max(
      input.authorizedQuantity,
      0,
    );

  const fulfilled =
    Math.max(
      input.fulfilledQuantity,
      0,
    );


  if (
    authorized > 0 &&
    fulfilled >= authorized
  ) {
    return 'COMPLETE';
  }


  if (
    fulfilled > 0
  ) {
    return 'PARTIAL';
  }


  return 'PENDING';
}


export function resolveAuthorizationOperationalStatus(
  input: Readonly<{
    fulfilledQuantity: number;
    operationalEligible: boolean;
    remainingAssignedQuantity: number;
    authorizedQuantity: number;
  }>,
): AuthorizationOperationalStatus {
  const authorizedQuantity =
    Math.max(
      input.authorizedQuantity,
      0,
    );

  const fulfilledQuantity =
    Math.max(
      input.fulfilledQuantity,
      0,
    );

  const remainingAuthorizedQuantity =
    Math.max(
      authorizedQuantity
      -
      fulfilledQuantity,
      0,
    );


  /*
   * Precedencia:
   *
   * 1. Solo se cierra al consumir TODO lo autorizado.
   * 2. No elegible => OUT_OF_OPERATION.
   * 3. Sin saldo asignado => UNASSIGNED.
   * 4. Asignación menor al saldo pendiente =>
   *    PARTIALLY_ASSIGNED.
   * 5. Cobertura suficiente del saldo pendiente =>
   *    ASSIGNED.
   */
  if (
    authorizedQuantity >
      0
    &&
    remainingAuthorizedQuantity ===
      0
  ) {
    return 'CLOSED';
  }


  if (
    !input.operationalEligible
  ) {
    return 'OUT_OF_OPERATION';
  }


  if (
    input.remainingAssignedQuantity <=
    0
  ) {
    return 'UNASSIGNED';
  }


  if (
    remainingAuthorizedQuantity >
      0
    &&
    input.remainingAssignedQuantity <
      remainingAuthorizedQuantity
  ) {
    return 'PARTIALLY_ASSIGNED';
  }


  return 'ASSIGNED';
}
