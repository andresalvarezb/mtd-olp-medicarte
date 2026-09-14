import { describe, expect, it } from 'vitest';
import { canTransitionPurchaseOrder, purchaseOrderBucket } from './purchase-order';

describe('purchase order state machine', () => {
  it('allows only explicit transitions', () => {
    expect(canTransitionPurchaseOrder('DRAFT', 'ISSUED')).toBe(true);
    expect(canTransitionPurchaseOrder('ISSUED', 'ACCEPTED')).toBe(false);
    expect(canTransitionPurchaseOrder('ACCEPTED', 'CANCELLED')).toBe(false);
  });
  it('maps type to one bucket', () => {
    expect(purchaseOrderBucket('STANDARD')).toBe('REGULAR');
    expect(purchaseOrderBucket('COMPLEMENTARY')).toBe('LATE');
  });
});
