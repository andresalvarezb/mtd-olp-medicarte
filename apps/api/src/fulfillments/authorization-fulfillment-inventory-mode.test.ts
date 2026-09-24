import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveAuthorizationFulfillmentInventoryMode,
} from './authorization-fulfillment-inventory-mode';


describe(
  'authorization fulfillment inventory mode',
  () => {
    it(
      'usa DIRECT_RECEIPT cuando la OC fue recibida por quantity-only',
      () => {
        expect(
          resolveAuthorizationFulfillmentInventoryMode({
            hasDirectReceipt: true,
            hasLegacyDelivery: false,
          }),
        ).toBe(
          'DIRECT_RECEIPT',
        );
      },
    );


    it(
      'conserva LOT_LEDGER para el flujo historico',
      () => {
        expect(
          resolveAuthorizationFulfillmentInventoryMode({
            hasDirectReceipt: false,
            hasLegacyDelivery: true,
          }),
        ).toBe(
          'LOT_LEDGER',
        );
      },
    );


    it(
      'no inventa flujo directo si no hay recepcion quantity-only',
      () => {
        expect(
          resolveAuthorizationFulfillmentInventoryMode({
            hasDirectReceipt: false,
            hasLegacyDelivery: false,
          }),
        ).toBe(
          'LOT_LEDGER',
        );
      },
    );


    it(
      'rechaza mezclar recepcion directa y delivery legacy',
      () => {
        expect(
          () =>
            resolveAuthorizationFulfillmentInventoryMode({
              hasDirectReceipt: true,
              hasLegacyDelivery: true,
            }),
        ).toThrow(
          'AUTHORIZATION_FULFILLMENT_MIXED_INVENTORY_FLOW',
        );
      },
    );
  },
);
