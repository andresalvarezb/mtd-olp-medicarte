export type AuthorizationOperationalStatus =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'CLOSED';


export function resolveAuthorizationOperationalStatus(
  input: Readonly<{
    hasFulfillment: boolean;
    remainingAssignedQuantity: number;
  }>,
): AuthorizationOperationalStatus {
  if (
    input.hasFulfillment
  ) {
    return 'CLOSED';
  }

  if (
    input.remainingAssignedQuantity >
    0
  ) {
    return 'ASSIGNED';
  }

  return 'UNASSIGNED';
}
