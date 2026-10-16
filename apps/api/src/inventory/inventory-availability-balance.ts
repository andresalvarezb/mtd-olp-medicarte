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

/*
 * La recepción puede pertenecer a un punto mientras una entrega o
 * reserva histórica pertenece a otro. Ningún punto puede reutilizar
 * unidades ya consumidas por la misma OC en otra sede.
 */
export function calculateAssignableAvailability(
  pointReceived: number,
  pointFulfilled: number,
  pointAssigned: number,
  globalReceived: number,
  globalFulfilled: number,
  globalAssigned: number,
): number {
  return Math.min(
    calculateUnassignedAvailability(
      pointReceived,
      pointFulfilled,
      pointAssigned,
    ),
    calculateUnassignedAvailability(
      globalReceived,
      globalFulfilled,
      globalAssigned,
    ),
  );
}
