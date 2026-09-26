export function calculateUnassignedAvailability(
  receivedQuantity: number,
  fulfilledQuantity: number,
  assignedQuantity: number,
): number {
  return Math.max(
    receivedQuantity
      - fulfilledQuantity
      - assignedQuantity,
    0,
  );
}
