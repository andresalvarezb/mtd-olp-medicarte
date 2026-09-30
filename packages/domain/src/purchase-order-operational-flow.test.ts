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

  it(
    'closes when every line received the quantity managed by OLP',
    () => {
      expect(
        derivePurchaseOrderMacroStatus({
          olpAccepted:
            true,

          dispatchRecorded:
            true,

          lines: [
            {
              lineId:
                'A',

              commercialCode:
                '10342',

              requestedQuantity:
                325,

              managedQuantity:
                325,

              receivedQuantity:
                325,
            },
            {
              lineId:
                'B',

              commercialCode:
                '10517',

              requestedQuantity:
                909,

              managedQuantity:
                909,

              receivedQuantity:
                909,
            },
            {
              lineId:
                'C',

              commercialCode:
                'TF0034',

              requestedQuantity:
                89,

              managedQuantity:
                89,

              receivedQuantity:
                89,
            },
          ],
        }),
      ).toBe(
        'RECEIVED',
      );
    },
  );

  it(
    'uses OLP managed quantity instead of original requested quantity',
    () => {
      expect(
        derivePurchaseOrderMacroStatus({
          olpAccepted:
            true,

          dispatchRecorded:
            true,

          lines: [
            {
              lineId:
                'A',

              commercialCode:
                'PRODUCT-A',

              requestedQuantity:
                10,

              managedQuantity:
                8,

              receivedQuantity:
                8,
            },
          ],
        }),
      ).toBe(
        'RECEIVED',
      );
    },
  );

  it(
    'keeps received with pending when at least one managed line is incomplete',
    () => {
      expect(
        derivePurchaseOrderMacroStatus({
          olpAccepted:
            true,

          dispatchRecorded:
            true,

          lines: [
            {
              lineId:
                'A',

              commercialCode:
                'PRODUCT-A',

              requestedQuantity:
                10,

              managedQuantity:
                10,

              receivedQuantity:
                10,
            },
            {
              lineId:
                'B',

              commercialCode:
                'PRODUCT-B',

              requestedQuantity:
                5,

              managedQuantity:
                5,

              receivedQuantity:
                4,
            },
          ],
        }),
      ).toBe(
        'RECEIVED_WITH_PENDING',
      );
    },
  );

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
