export type AuthorizationFulfillmentInventoryMode =
  | 'DIRECT_RECEIPT'
  | 'LOT_LEDGER';


export function resolveAuthorizationFulfillmentInventoryMode(
  input: Readonly<{
    hasDirectReceipt: boolean;
    hasLegacyDelivery: boolean;
  }>,
): AuthorizationFulfillmentInventoryMode {
  if (
    input.hasDirectReceipt &&
    input.hasLegacyDelivery
  ) {
    throw new Error(
      'AUTHORIZATION_FULFILLMENT_MIXED_INVENTORY_FLOW',
    );
  }

  if (
    input.hasDirectReceipt
  ) {
    return 'DIRECT_RECEIPT';
  }

  return 'LOT_LEDGER';
}
