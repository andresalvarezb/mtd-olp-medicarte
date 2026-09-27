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
      'una AUTO elegible con OC pero sin allocation sigue UNASSIGNED',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment:
              false,

            operationalEligible:
              true,

            remainingAssignedQuantity:
              0,
          }),
        ).toBe(
          'UNASSIGNED',
        );
      },
    );


    it(
      'una AUTO elegible solo queda ASSIGNED con saldo allocation',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment:
              false,

            operationalEligible:
              true,

            remainingAssignedQuantity:
              4,
          }),
        ).toBe(
          'ASSIGNED',
        );
      },
    );


    it(
      'una AUTO no elegible sin cumplimiento queda OUT_OF_OPERATION',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment:
              false,

            operationalEligible:
              false,

            remainingAssignedQuantity:
              4,
          }),
        ).toBe(
          'OUT_OF_OPERATION',
        );
      },
    );


    it(
      'un cumplimiento real permanece CLOSED aunque la AUTO ya no sea elegible',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment:
              true,

            operationalEligible:
              false,

            remainingAssignedQuantity:
              0,
          }),
        ).toBe(
          'CLOSED',
        );
      },
    );
  },
);
