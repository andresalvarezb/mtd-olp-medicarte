import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  authorizationOperationalLabel,
} from './authorization-operational-display';


describe(
  'authorizationOperationalLabel',
  () => {
    it(
      'distingue AUTO sin OC',
      () => {
        expect(
          authorizationOperationalLabel({
            operationalStatus:
              'UNASSIGNED',

            fulfillmentProgressStatus:
              'PENDING',

            hasLinkedPurchaseOrder:
              false,
          }),
        ).toBe(
          'Pendiente de orden de compra',
        );
      },
    );


    it(
      'distingue AUTO con OC pero sin saldo físico',
      () => {
        expect(
          authorizationOperationalLabel({
            operationalStatus:
              'UNASSIGNED',

            fulfillmentProgressStatus:
              'PENDING',

            hasLinkedPurchaseOrder:
              true,
          }),
        ).toBe(
          'Pendiente de recepción/asignación',
        );
      },
    );


    it(
      'conserva asignación parcial',
      () => {
        expect(
          authorizationOperationalLabel({
            operationalStatus:
              'PARTIALLY_ASSIGNED',

            fulfillmentProgressStatus:
              'PENDING',

            hasLinkedPurchaseOrder:
              true,
          }),
        ).toBe(
          'Asignación parcial',
        );
      },
    );


    it(
      'conserva lista para entrega/aplicación',
      () => {
        expect(
          authorizationOperationalLabel({
            operationalStatus:
              'ASSIGNED',

            fulfillmentProgressStatus:
              'PENDING',

            hasLinkedPurchaseOrder:
              true,
          }),
        ).toBe(
          'Lista para entrega/aplicación',
        );
      },
    );


    it(
      'mantiene atención parcial con precedencia',
      () => {
        expect(
          authorizationOperationalLabel({
            operationalStatus:
              'UNASSIGNED',

            fulfillmentProgressStatus:
              'PARTIAL',

            hasLinkedPurchaseOrder:
              false,
          }),
        ).toBe(
          'Con aplicación pendiente',
        );
      },
    );


    it(
      'mantiene CLOSED con precedencia absoluta',
      () => {
        expect(
          authorizationOperationalLabel({
            operationalStatus:
              'CLOSED',

            fulfillmentProgressStatus:
              'COMPLETE',

            hasLinkedPurchaseOrder:
              false,
          }),
        ).toBe(
          'Cerrada',
        );
      },
    );


    it(
      'conserva fuera de operación',
      () => {
        expect(
          authorizationOperationalLabel({
            operationalStatus:
              'OUT_OF_OPERATION',

            fulfillmentProgressStatus:
              'PENDING',

            hasLinkedPurchaseOrder:
              false,
          }),
        ).toBe(
          'Fuera de operación',
        );
      },
    );
  },
);
