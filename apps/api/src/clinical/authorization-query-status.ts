export type AuthorizationOperationalStatus =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'OUT_OF_OPERATION'
  | 'CLOSED';


export function resolveAuthorizationOperationalStatus(
  input: Readonly<{
    hasFulfillment: boolean;
    operationalEligible: boolean;
    remainingAssignedQuantity: number;
  }>,
): AuthorizationOperationalStatus {
  /*
   * Precedencia:
   *
   * 1. Un cumplimiento real nunca se pierde por
   *    vencimiento posterior.
   *
   * 2. Sin cumplimiento, una AUTO no elegible no
   *    puede presentarse como pendiente de inventario.
   *
   * 3. Solo las AUTO elegibles se clasifican según
   *    tengan o no saldo asignado.
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
    input.remainingAssignedQuantity >
      0
  ) {
    return 'ASSIGNED';
  }

  return 'UNASSIGNED';
}
