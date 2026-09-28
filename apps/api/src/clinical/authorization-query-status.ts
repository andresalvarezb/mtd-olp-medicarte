export type AuthorizationOperationalStatus =
  | 'UNASSIGNED'
  | 'PARTIALLY_ASSIGNED'
  | 'ASSIGNED'
  | 'OUT_OF_OPERATION'
  | 'CLOSED';


export function resolveAuthorizationOperationalStatus(
  input: Readonly<{
    hasFulfillment: boolean;
    operationalEligible: boolean;
    remainingAssignedQuantity: number;
    authorizedQuantity: number;
  }>,
): AuthorizationOperationalStatus {
  /*
   * Precedencia:
   *
   * 1. Cumplimiento real => CLOSED.
   * 2. No elegible => OUT_OF_OPERATION.
   * 3. Sin saldo => UNASSIGNED.
   * 4. Saldo menor a la cantidad autorizada =>
   *    PARTIALLY_ASSIGNED.
   * 5. Cobertura completa => ASSIGNED.
   */
  if (
    input.hasFulfillment
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
    input.authorizedQuantity >
      0
    &&
    input.remainingAssignedQuantity <
      input.authorizedQuantity
  ) {
    return 'PARTIALLY_ASSIGNED';
  }

  return 'ASSIGNED';
}
