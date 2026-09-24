export const PURCHASE_ORDER_MACRO_STATUSES = [
  'PENDING_OLP',
  'PENDING_MEDICARTE',
  'RECEIVED_WITH_PENDING',
  'RECEIVED',
] as const;

export type PurchaseOrderMacroStatus = (typeof PURCHASE_ORDER_MACRO_STATUSES)[number];

export const PURCHASE_ORDER_MACRO_STATUS_LABELS: Readonly<
  Record<PurchaseOrderMacroStatus, string>
> = {
  PENDING_OLP: 'Pendiente OLP',

  PENDING_MEDICARTE: 'Pendiente Medicarte',

  RECEIVED_WITH_PENDING: 'Recibida con pendientes',

  RECEIVED: 'Recibida',
};

export type PurchaseOrderQuantityLine = Readonly<{
  lineId: string;
  commercialCode: string;
  requestedQuantity: number;
  receivedQuantity: number;
}>;

export type PurchaseOrderOperationalSnapshot = Readonly<{
  olpAccepted: boolean;
  dispatchRecorded: boolean;
  lines: readonly PurchaseOrderQuantityLine[];
}>;

export type PurchaseOrderOperationalActions = Readonly<{
  olpCanAccept: boolean;
  olpCanRecordDispatch: boolean;
  medicarteCanReceive: boolean;
  orderClosed: boolean;
}>;

export type PurchaseOrderLineBalance = Readonly<{
  lineId: string;
  commercialCode: string;
  requestedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
  complete: boolean;
}>;

export class PurchaseOrderOperationalFlowError extends Error {
  constructor(readonly code: string) {
    super(code);

    this.name = 'PurchaseOrderOperationalFlowError';
  }
}

function assertNonNegativeInteger(value: number, code: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new PurchaseOrderOperationalFlowError(code);
  }
}

function assertPositiveRequestedQuantity(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_REQUESTED_QUANTITY_INVALID');
  }
}

export function purchaseOrderLineBalance(
  line: PurchaseOrderQuantityLine,
): PurchaseOrderLineBalance {
  assertPositiveRequestedQuantity(line.requestedQuantity);

  assertNonNegativeInteger(line.receivedQuantity, 'PURCHASE_ORDER_RECEIVED_QUANTITY_INVALID');

  if (line.receivedQuantity > line.requestedQuantity) {
    throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_OVER_RECEIPT');
  }

  const pendingQuantity = line.requestedQuantity - line.receivedQuantity;

  return {
    lineId: line.lineId,

    commercialCode: line.commercialCode,

    requestedQuantity: line.requestedQuantity,

    receivedQuantity: line.receivedQuantity,

    pendingQuantity,

    complete: pendingQuantity === 0,
  };
}

export function purchaseOrderBalances(
  lines: readonly PurchaseOrderQuantityLine[],
): readonly PurchaseOrderLineBalance[] {
  if (lines.length === 0) {
    throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_LINES_REQUIRED');
  }

  const seen = new Set<string>();

  return lines.map((line) => {
    if (seen.has(line.lineId)) {
      throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_LINE_DUPLICATED');
    }

    seen.add(line.lineId);

    return purchaseOrderLineBalance(line);
  });
}

export function hasAnyPurchaseOrderReceipt(lines: readonly PurchaseOrderQuantityLine[]): boolean {
  return purchaseOrderBalances(lines).some((line) => line.receivedQuantity > 0);
}

export function isPurchaseOrderFullyReceived(lines: readonly PurchaseOrderQuantityLine[]): boolean {
  return purchaseOrderBalances(lines).every((line) => line.complete);
}

export function derivePurchaseOrderMacroStatus(
  snapshot: PurchaseOrderOperationalSnapshot,
): PurchaseOrderMacroStatus {
  const balances = purchaseOrderBalances(snapshot.lines);

  if (balances.every((line) => line.complete)) {
    return 'RECEIVED';
  }

  const hasReceipt = balances.some((line) => line.receivedQuantity > 0);

  if (hasReceipt) {
    return 'RECEIVED_WITH_PENDING';
  }

  if (snapshot.olpAccepted) {
    return 'PENDING_MEDICARTE';
  }

  return 'PENDING_OLP';
}

export function derivePurchaseOrderActions(
  snapshot: PurchaseOrderOperationalSnapshot,
): PurchaseOrderOperationalActions {
  const status = derivePurchaseOrderMacroStatus(snapshot);

  const orderClosed = status === 'RECEIVED';

  return {
    olpCanAccept:
      !snapshot.olpAccepted &&
      !orderClosed,

    olpCanRecordDispatch:
      false,

    medicarteCanReceive:
      snapshot.olpAccepted &&
      !orderClosed,

    orderClosed,
  };
}

export type PurchaseOrderReceiptInputLine = Readonly<{
  lineId: string;
  receivedNow: number;
}>;

export function applyPurchaseOrderReceipt(
  current: readonly PurchaseOrderQuantityLine[],

  receipt: readonly PurchaseOrderReceiptInputLine[],
): readonly PurchaseOrderQuantityLine[] {
  if (receipt.length === 0) {
    throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_RECEIPT_LINES_REQUIRED');
  }

  const currentBalances = purchaseOrderBalances(current);

  const currentById = new Map(currentBalances.map((line) => [line.lineId, line]));

  const receiptById = new Map<string, number>();

  let positiveLines = 0;

  for (const line of receipt) {
    if (receiptById.has(line.lineId)) {
      throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_RECEIPT_LINE_DUPLICATED');
    }

    assertNonNegativeInteger(line.receivedNow, 'PURCHASE_ORDER_RECEIPT_QUANTITY_INVALID');

    const currentLine = currentById.get(line.lineId);

    if (!currentLine) {
      throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_RECEIPT_UNKNOWN_LINE');
    }

    if (line.receivedNow > currentLine.pendingQuantity) {
      throw new PurchaseOrderOperationalFlowError('PURCHASE_ORDER_OVER_RECEIPT');
    }

    if (line.receivedNow > 0) {
      positiveLines += 1;
    }

    receiptById.set(line.lineId, line.receivedNow);
  }

  if (positiveLines === 0) {
    throw new PurchaseOrderOperationalFlowError(
      'PURCHASE_ORDER_RECEIPT_POSITIVE_QUANTITY_REQUIRED',
    );
  }

  return currentBalances.map((line) => ({
    lineId: line.lineId,

    commercialCode: line.commercialCode,

    requestedQuantity: line.requestedQuantity,

    receivedQuantity: line.receivedQuantity + (receiptById.get(line.lineId) ?? 0),
  }));
}
