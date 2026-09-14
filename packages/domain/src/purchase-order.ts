import { purchaseOrderTransitions, type PurchaseOrderDemandBucket, type PurchaseOrderStatus, type PurchaseOrderType } from '@authorization/contracts';

export function canTransitionPurchaseOrder(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  return purchaseOrderTransitions[from].includes(to);
}

export function purchaseOrderBucket(type: PurchaseOrderType): PurchaseOrderDemandBucket {
  return type === 'STANDARD' ? 'REGULAR' : 'LATE';
}
