import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveAuthorizationFulfillmentProgressStatus,
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
            fulfilledQuantity: 0,
            operationalEligible: true,
            remainingAssignedQuantity: 0,
            authorizedQuantity: 30,
          }),
        ).toBe(
          'UNASSIGNED',
        );
      },
    );


    it(
      'compara la asignación contra el saldo pendiente y no contra el autorizado original',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            fulfilledQuantity: 3,
            operationalEligible: true,
            remainingAssignedQuantity: 7,
            authorizedQuantity: 10,
          }),
        ).toBe(
          'ASSIGNED',
        );
      },
    );


    it(
      'una cobertura inferior al pendiente queda PARTIALLY_ASSIGNED',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            fulfilledQuantity: 3,
            operationalEligible: true,
            remainingAssignedQuantity: 4,
            authorizedQuantity: 10,
          }),
        ).toBe(
          'PARTIALLY_ASSIGNED',
        );
      },
    );


    it(
      'un fulfillment parcial NO cierra la AUTO',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            fulfilledQuantity: 2,
            operationalEligible: true,
            remainingAssignedQuantity: 8,
            authorizedQuantity: 10,
          }),
        ).toBe(
          'ASSIGNED',
        );
      },
    );


    it(
      'cierra únicamente al alcanzar toda la cantidad autorizada',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            fulfilledQuantity: 10,
            operationalEligible: false,
            remainingAssignedQuantity: 0,
            authorizedQuantity: 10,
          }),
        ).toBe(
          'CLOSED',
        );
      },
    );


    it(
      'una AUTO no elegible e incompleta queda OUT_OF_OPERATION',
      () => {
        expect(
          resolveAuthorizationOperationalStatus({
            fulfilledQuantity: 3,
            operationalEligible: false,
            remainingAssignedQuantity: 7,
            authorizedQuantity: 10,
          }),
        ).toBe(
          'OUT_OF_OPERATION',
        );
      },
    );
  },
);


describe(
  'authorization fulfillment progress',
  () => {
    it(
      'PENDING cuando no existe consumo',
      () => {
        expect(
          resolveAuthorizationFulfillmentProgressStatus({
            authorizedQuantity: 10,
            fulfilledQuantity: 0,
          }),
        ).toBe(
          'PENDING',
        );
      },
    );


    it(
      'PARTIAL cuando existe consumo menor al autorizado',
      () => {
        expect(
          resolveAuthorizationFulfillmentProgressStatus({
            authorizedQuantity: 10,
            fulfilledQuantity: 3,
          }),
        ).toBe(
          'PARTIAL',
        );
      },
    );


    it(
      'COMPLETE cuando alcanza o supera lo autorizado',
      () => {
        expect(
          resolveAuthorizationFulfillmentProgressStatus({
            authorizedQuantity: 10,
            fulfilledQuantity: 10,
          }),
        ).toBe(
          'COMPLETE',
        );
      },
    );
  },
);
