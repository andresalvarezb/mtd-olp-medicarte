import { describe, expect, it } from 'vitest';
import { deriveReceiptConformity, validateReceiptQuantities } from './receipt';

describe('receipt domain', () => {
  it('enforces quantity invariants', () => {
    expect(validateReceiptQuantities({ dispatched: 20, received: 18, accepted: 17, rejected: 0 })).toBe('RECEIPT_QUANTITY_SUM_INVALID');
    expect(validateReceiptQuantities({ dispatched: 20, received: 21, accepted: 21, rejected: 0 })).toBe('RECEIPT_OVER_RECEIVED');
    expect(validateReceiptQuantities({ dispatched: 20, received: 20, accepted: 18, rejected: 2 })).toBeNull();
  });
  it('derives independent conformity from quantities and discrepancies', () => {
    expect(deriveReceiptConformity({ dispatched: 20, received: 20, accepted: 20, rejected: 0 }, false)).toBe('CONFORMING');
    expect(deriveReceiptConformity({ dispatched: 20, received: 20, accepted: 18, rejected: 2 }, false)).toBe('PARTIALLY_CONFORMING');
    expect(deriveReceiptConformity({ dispatched: 20, received: 20, accepted: 20, rejected: 0 }, true)).toBe('PARTIALLY_CONFORMING');
    expect(deriveReceiptConformity({ dispatched: 20, received: 0, accepted: 0, rejected: 0 }, false)).toBe('NON_CONFORMING');
  });
});
