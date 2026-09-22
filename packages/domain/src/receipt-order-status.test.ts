import { describe, expect, it } from 'vitest';
import { derivePurchaseOrderReceiptStatus } from './receipt';

describe('purchase order receipt status', () => {
  it('marks supplier short delivery as partial', () => {
    expect(derivePurchaseOrderReceiptStatus(10, 7)).toBe('PARTIALLY_RECEIVED');
  });

  it('marks physically complete receipt as received even with quality rejection', () => {
    expect(derivePurchaseOrderReceiptStatus(10, 10)).toBe('RECEIVED');
  });
});
