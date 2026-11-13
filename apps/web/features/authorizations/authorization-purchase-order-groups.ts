import type { AuthorizationLinkedPurchaseOrder } from '@/lib/authorization-query-api';

type Input = Readonly<{
  purchaseOrders: ReadonlyArray<AuthorizationLinkedPurchaseOrder>;
  remainingAuthorizedQuantity: number;
  remainingAssignedQuantity: number;
}>;

// Separa reserva fisica de origen comercial.
export function groupAuthorizationPurchaseOrders(input: Input) {
  const forDelivery = input.purchaseOrders.filter(
    (po) => po.availableQuantity > 0,
  );
  const fullyReserved =
    input.remainingAuthorizedQuantity > 0 &&
    input.remainingAssignedQuantity >= input.remainingAuthorizedQuantity;

  const commercialOrigins = input.purchaseOrders
    .filter((po) => po.sourceQuantity > 0)
    .map((po) => ({
      ...po,
      coveredByOtherOrder:
        fullyReserved &&
        po.availableQuantity === 0 &&
        forDelivery.some((physical) => physical.id !== po.id),
    }));

  return { forDelivery, commercialOrigins };
}
