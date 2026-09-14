export type ReceiptQuantityInput = Readonly<{
  dispatched: number;
  received: number;
  accepted: number;
  rejected: number;
}>;
export type ReceiptConformity = 'CONFORMING' | 'PARTIALLY_CONFORMING' | 'NON_CONFORMING';

export function validateReceiptQuantities(input: ReceiptQuantityInput): string | null {
  if (input.received < 0 || input.received > input.dispatched) return 'RECEIPT_OVER_RECEIVED';
  if (input.accepted < 0 || input.accepted > input.received) return 'RECEIPT_ACCEPTED_INVALID';
  if (input.rejected < 0 || input.rejected > input.received) return 'RECEIPT_REJECTED_INVALID';
  if (input.accepted + input.rejected !== input.received) return 'RECEIPT_QUANTITY_SUM_INVALID';
  return null;
}

export function deriveReceiptConformity(
  input: ReceiptQuantityInput,
  discrepancy: boolean,
): ReceiptConformity {
  if (input.accepted === 0) return 'NON_CONFORMING';
  if (
    input.accepted === input.dispatched &&
    input.rejected === 0 &&
    input.received === input.dispatched &&
    !discrepancy
  )
    return 'CONFORMING';
  return 'PARTIALLY_CONFORMING';
}
