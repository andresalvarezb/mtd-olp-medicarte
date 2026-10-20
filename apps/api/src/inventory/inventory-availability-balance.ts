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

/** Capacidad de compra sin recibir ni comprometer; no es stock físico. */
export function calculateUncommittedPurchaseBalance(
  requestedQuantity: number,
  globalReceivedQuantity: number,
  activeCommitmentQuantity: number,
): number {
  return Math.max(
    0,
    Math.max(requestedQuantity, 0) - Math.max(
      Math.max(globalReceivedQuantity, 0),
      Math.max(activeCommitmentQuantity, 0),
    ),
  );
}
