import type { PurchaseOrderMacroStatus } from './purchase-order-operational-flow';

export const PURCHASE_ORDER_ACTION_PERMISSIONS = {
  VIEW: 'purchase_orders.read',

  UPLOAD: 'purchase_orders.manage',

  ACCEPT_OLP: 'purchase_orders.review_supplier',

  RECORD_DISPATCH: 'supplier_deliveries.manage',

  RECORD_RECEIPT: 'medicarte_receipts.manage',
} as const;

export type PurchaseOrderPermissionAction = keyof typeof PURCHASE_ORDER_ACTION_PERMISSIONS;

export function permissionForPurchaseOrderAction(action: PurchaseOrderPermissionAction): string {
  return PURCHASE_ORDER_ACTION_PERMISSIONS[action];
}

export const PURCHASE_ORDER_ACTORS = ['MTD', 'OLP', 'MEDICARTE', 'AUDIT', 'READ_ONLY'] as const;

export type PurchaseOrderActor = (typeof PURCHASE_ORDER_ACTORS)[number];

export type PurchaseOrderOperationalContext = Readonly<{
  actor: PurchaseOrderActor;

  status: PurchaseOrderMacroStatus;

  olpAccepted: boolean;
}>;

export type PurchaseOrderAllowedActions = Readonly<{
  canView: boolean;

  canUpload: boolean;

  canAcceptOlP: boolean;

  canRecordDispatch: boolean;

  canRecordReceipt: boolean;

  canEditRequestedQuantity: boolean;
}>;

export type PurchaseOrderFieldAccess = Readonly<{
  requestedQuantity: 'READ' | 'HIDDEN';

  dispatchedQuantity: 'READ' | 'EDIT' | 'HIDDEN';

  receivedQuantity: 'READ' | 'EDIT' | 'HIDDEN';

  pendingQuantity: 'READ' | 'HIDDEN';

  committedDispatchDate: 'READ' | 'EDIT' | 'HIDDEN';

  dispatchDate: 'READ' | 'EDIT' | 'HIDDEN';

  receiptDate: 'READ' | 'EDIT' | 'HIDDEN';

  olpObservation: 'READ' | 'EDIT' | 'HIDDEN';

  medicarteObservation: 'READ' | 'EDIT' | 'HIDDEN';

  auditTimestamps: 'READ' | 'HIDDEN';
}>;

export function derivePurchaseOrderAllowedActions(
  context: PurchaseOrderOperationalContext,
): PurchaseOrderAllowedActions {
  const { actor, status, olpAccepted } = context;

  const canAcceptOlP = actor === 'OLP' && status === 'PENDING_OLP' && !olpAccepted;

  const canRecordDispatch = actor === 'OLP' && status === 'PENDING_OLP' && olpAccepted;

  const canRecordReceipt =
    actor === 'MEDICARTE' && (status === 'PENDING_MEDICARTE' || status === 'RECEIVED_WITH_PENDING');

  return {
    canView: true,

    canUpload: actor === 'MTD',

    canAcceptOlP,

    canRecordDispatch,

    canRecordReceipt,

    canEditRequestedQuantity: false,
  };
}

export function derivePurchaseOrderFieldAccess(
  context: PurchaseOrderOperationalContext,
): PurchaseOrderFieldAccess {
  const actions = derivePurchaseOrderAllowedActions(context);

  const actor = context.actor;

  return {
    requestedQuantity: 'READ',

    dispatchedQuantity: actions.canRecordDispatch ? 'EDIT' : 'READ',

    receivedQuantity: actions.canRecordReceipt ? 'EDIT' : 'READ',

    pendingQuantity: 'READ',

    committedDispatchDate: actions.canAcceptOlP ? 'EDIT' : 'READ',

    dispatchDate: actions.canRecordDispatch ? 'EDIT' : 'READ',

    receiptDate: actions.canRecordReceipt ? 'EDIT' : 'READ',

    olpObservation: actions.canAcceptOlP || actions.canRecordDispatch ? 'EDIT' : 'READ',

    medicarteObservation: actions.canRecordReceipt ? 'EDIT' : 'READ',

    auditTimestamps:
      actor === 'MTD' ||
      actor === 'AUDIT' ||
      actor === 'READ_ONLY' ||
      actor === 'OLP' ||
      actor === 'MEDICARTE'
        ? 'READ'
        : 'HIDDEN',
  };
}

export function assertPurchaseOrderAction(
  context: PurchaseOrderOperationalContext,

  action: 'UPLOAD' | 'ACCEPT_OLP' | 'RECORD_DISPATCH' | 'RECORD_RECEIPT',
): void {
  const allowed = derivePurchaseOrderAllowedActions(context);

  const permitted =
    (action === 'UPLOAD' && allowed.canUpload) ||
    (action === 'ACCEPT_OLP' && allowed.canAcceptOlP) ||
    (action === 'RECORD_DISPATCH' && allowed.canRecordDispatch) ||
    (action === 'RECORD_RECEIPT' && allowed.canRecordReceipt);

  if (!permitted) {
    throw new Error('PURCHASE_ORDER_ACTION_FORBIDDEN');
  }
}
