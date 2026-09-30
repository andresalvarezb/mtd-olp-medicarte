import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  AuthorizationFulfillmentError,
  assertAuthorizationFulfillment,
} from './authorization-fulfillment';


const base = {
  effectiveDate:
    '2026-09-20',

  validityEndDate:
    '2026-09-15',

  todayBogota:
    '2026-09-30',

  requestedQuantity:
    2,

  remainingAuthorizedQuantity:
    10,

  assignedQuantity:
    10,

  pointCount:
    1,

  alreadyClosed:
    false,
} as const;


describe(
  'authorization fulfillment',
  () => {
    it(
      'permite consumo parcial',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment(
              base,
            ),
        ).not.toThrow();
      },
    );


    it(
      'permite aplicación posterior al vencimiento',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              effectiveDate:
                '2026-09-29',
            }),
        ).not.toThrow();
      },
    );


    it(
      'rechaza fecha futura',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              effectiveDate:
                '2026-10-01',
            }),
        ).toThrowError(
          AuthorizationFulfillmentError,
        );
      },
    );


    it(
      'rechaza cantidad cero',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              requestedQuantity:
                0,
            }),
        ).toThrowError(
          AuthorizationFulfillmentError,
        );
      },
    );


    it(
      'rechaza cantidad superior al pendiente autorizado',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              requestedQuantity:
                6,

              remainingAuthorizedQuantity:
                5,
            }),
        ).toThrowError(
          AuthorizationFulfillmentError,
        );
      },
    );


    it(
      'rechaza cantidad superior al saldo asignado',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              requestedQuantity:
                6,

              assignedQuantity:
                5,
            }),
        ).toThrowError(
          AuthorizationFulfillmentError,
        );
      },
    );


    it(
      'permite consumir exactamente el saldo pendiente',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              requestedQuantity:
                5,

              remainingAuthorizedQuantity:
                5,

              assignedQuantity:
                5,
            }),
        ).not.toThrow();
      },
    );


    it(
      'rechaza una AUTO ya completada',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              remainingAuthorizedQuantity:
                0,

              alreadyClosed:
                true,
            }),
        ).toThrowError(
          AuthorizationFulfillmentError,
        );
      },
    );


    it(
      'requiere un único punto',
      () => {
        expect(
          () =>
            assertAuthorizationFulfillment({
              ...base,

              pointCount:
                2,
            }),
        ).toThrowError(
          AuthorizationFulfillmentError,
        );
      },
    );
  },
);
