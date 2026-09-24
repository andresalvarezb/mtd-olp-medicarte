import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveAuthorizationOperationalStatus,
} from './authorization-query-status';


describe(
  'authorization query operational status',
  () => {
    it(
      'una AUTO con OC pero sin allocation sigue UNASSIGNED',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: false,
            remainingAssignedQuantity: 0,
          }),
        ).toBe(
          'UNASSIGNED',
        );
      },
    );


    it(
      'una AUTO solo queda ASSIGNED cuando tiene saldo allocation',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: false,
            remainingAssignedQuantity: 4,
          }),
        ).toBe(
          'ASSIGNED',
        );
      },
    );


    it(
      'una AUTO consumida queda CLOSED aunque ya no tenga saldo',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: true,
            remainingAssignedQuantity: 0,
          }),
        ).toBe(
          'CLOSED',
        );
      },
    );
  },
);
