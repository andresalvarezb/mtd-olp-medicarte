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
      'una AUTO elegible sin allocation queda UNASSIGNED',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: false,
            operationalEligible: true,
            remainingAssignedQuantity: 0,
            authorizedQuantity: 30,
          }),
        ).toBe('UNASSIGNED');
      },
    );


    it(
      'una AUTO elegible con cobertura parcial queda PARTIALLY_ASSIGNED',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: false,
            operationalEligible: true,
            remainingAssignedQuantity: 30,
            authorizedQuantity: 60,
          }),
        ).toBe('PARTIALLY_ASSIGNED');
      },
    );


    it(
      'una AUTO elegible completamente cubierta queda ASSIGNED',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: false,
            operationalEligible: true,
            remainingAssignedQuantity: 30,
            authorizedQuantity: 30,
          }),
        ).toBe('ASSIGNED');
      },
    );


    it(
      'una AUTO no elegible queda OUT_OF_OPERATION',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: false,
            operationalEligible: false,
            remainingAssignedQuantity: 30,
            authorizedQuantity: 30,
          }),
        ).toBe('OUT_OF_OPERATION');
      },
    );


    it(
      'un cumplimiento real conserva precedencia CLOSED',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            hasFulfillment: true,
            operationalEligible: false,
            remainingAssignedQuantity: 0,
            authorizedQuantity: 30,
          }),
        ).toBe('CLOSED');
      },
    );
  },
);
