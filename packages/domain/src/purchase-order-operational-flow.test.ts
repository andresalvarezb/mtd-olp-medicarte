import { describe, expect, it } from 'vitest';

import {
  PurchaseOrderOperationalFlowError,
  applyPurchaseOrderReceipt,
  derivePurchaseOrderActions,
  derivePurchaseOrderMacroStatus,
  purchaseOrderBalances,
} from './purchase-order-operational-flow';

const initial = [
  {
    lineId: 'A',

    commercialCode: '10156',

    requestedQuantity: 20,

    receivedQuantity: 0,
  },
  {
    lineId: 'B',

    commercialCode: '10157',

    requestedQuantity: 8,

    receivedQuantity: 0,
  },
] as const;

describe('purchase order operational flow', () => {
  it('starts as Pendiente OLP', () => {
    expect(
      derivePurchaseOrderMacroStatus({
        olpAccepted: false,

        dispatchRecorded: false,

        lines: initial,
      }),
    ).toBe('PENDING_OLP');
  });

  it('moves to Pendiente Medicarte when OLP accepts the order', () => {
    expect(
      derivePurchaseOrderMacroStatus({
        olpAccepted: true,

        dispatchRecorded: false,

        lines: initial,
      }),
    ).toBe('PENDING_MEDICARTE');
  });

  it('does not advance to Medicarte without OLP acceptance', () => {
    expect(
      derivePurchaseOrderMacroStatus({
        olpAccepted: false,

        dispatchRecorded: true,

        lines: initial,
      }),
    ).toBe('PENDING_OLP');
  });

  it('keeps Medicarte responsible across multiple partial receipts', () => {
    const first = applyPurchaseOrderReceipt(initial, [
      {
        lineId: 'A',

        receivedNow: 10,
      },
      {
        lineId: 'B',

        receivedNow: 8,
      },
    ]);

    expect(
      derivePurchaseOrderMacroStatus({
        olpAccepted: true,

        dispatchRecorded: true,

        lines: first,
      }),
    ).toBe('RECEIVED_WITH_PENDING');

    const second = applyPurchaseOrderReceipt(first, [
      {
        lineId: 'A',

        receivedNow: 6,
      },
    ]);

    expect(
      derivePurchaseOrderMacroStatus({
        olpAccepted: true,

        dispatchRecorded: true,

        lines: second,
      }),
    ).toBe('RECEIVED_WITH_PENDING');

    const actions = derivePurchaseOrderActions({
      olpAccepted: true,

      dispatchRecorded: true,

      lines: second,
    });

    expect(actions.medicarteCanReceive).toBe(true);

    expect(actions.olpCanRecordDispatch).toBe(false);
  });

  it('closes only when every product line reaches requested quantity', () => {
    const received = applyPurchaseOrderReceipt(initial, [
      {
        lineId: 'A',

        receivedNow: 20,
      },
      {
        lineId: 'B',

        receivedNow: 8,
      },
    ]);

    expect(
      derivePurchaseOrderMacroStatus({
        olpAccepted: true,

        dispatchRecorded: true,

        lines: received,
      }),
    ).toBe('RECEIVED');

    expect(
      derivePurchaseOrderActions({
        olpAccepted: true,

        dispatchRecorded: true,

        lines: received,
      }),
    ).toEqual({
      olpCanAccept: false,

      olpCanRecordDispatch: false,

      medicarteCanReceive: false,

      orderClosed: true,
    });
  });

  it('never closes using only the grand total when a product is still pending', () => {
    expect(() =>
      purchaseOrderBalances([
        {
          lineId: 'A',

          commercialCode: '10156',

          requestedQuantity: 10,

          receivedQuantity: 12,
        },
        {
          lineId: 'B',

          commercialCode: '10157',

          requestedQuantity: 10,

          receivedQuantity: 8,
        },
      ]),
    ).toThrowError(PurchaseOrderOperationalFlowError);
  });

  it('rejects receiving more than the pending quantity', () => {
    const partial = [
      {
        lineId: 'A',

        commercialCode: '10156',

        requestedQuantity: 20,

        receivedQuantity: 17,
      },
    ] as const;

    expect(() =>
      applyPurchaseOrderReceipt(partial, [
        {
          lineId: 'A',

          receivedNow: 4,
        },
      ]),
    ).toThrowError('PURCHASE_ORDER_OVER_RECEIPT');
  });

  it('supports one or many Medicarte receptions until completion', () => {
    const first = applyPurchaseOrderReceipt(
      [
        {
          lineId: 'A',

          commercialCode: '10156',

          requestedQuantity: 20,

          receivedQuantity: 0,
        },
      ],
      [
        {
          lineId: 'A',

          receivedNow: 10,
        },
      ],
    );

    const second = applyPurchaseOrderReceipt(first, [
      {
        lineId: 'A',

        receivedNow: 6,
      },
    ]);

    const third = applyPurchaseOrderReceipt(second, [
      {
        lineId: 'A',

        receivedNow: 4,
      },
    ]);

    expect(third[0]?.receivedQuantity).toBe(20);
  });
});
