import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveAuthorizationLifecycleReasons,
} from './authorization-query-state';


describe(
  'resolveAuthorizationLifecycleReasons',
  () => {
    it(
      'explica producto fuera de AT y vigencia vencida',
      () => {
        expect(
          resolveAuthorizationLifecycleReasons({
            lifecycleStatus:
              'DISABLED',

            enablementStatus:
              'ENABLED',

            tariffMembershipStatus:
              'NOT_LISTED',

            coverageType:
              'PBS',

            directionStatus:
              'NOT_APPLICABLE',

            quantity:
              '2',

            minimumQuantity:
              1,

            validityStatus:
              'EXPIRED',
          }),
        ).toEqual([
          {
            code:
              'PRODUCT_NOT_IN_TARIFF',

            message:
              'Producto no listado/activo en Anexo Tarifario',
          },

          {
            code:
              'EXPIRED',

            message:
              'Fecha final de vigencia vencida',
          },
        ]);
      },
    );


    it(
      'explica cantidad inferior al mínimo del AT',
      () => {
        expect(
          resolveAuthorizationLifecycleReasons({
            lifecycleStatus:
              'DISABLED',

            enablementStatus:
              'ENABLED',

            tariffMembershipStatus:
              'LISTED',

            coverageType:
              'PBS',

            directionStatus:
              'NOT_APPLICABLE',

            quantity:
              '1',

            minimumQuantity:
              2,

            validityStatus:
              'IN_WINDOW',
          }),
        ).toEqual([
          {
            code:
              'BELOW_MINIMUM_QUANTITY',

            message:
              'Cantidad autorizada 1 inferior a la cantidad mínima 2 del Anexo Tarifario',
          },
        ]);
      },
    );


    it(
      'una fecha inválida tiene precedencia sobre condiciones pendientes',
      () => {
        expect(
          resolveAuthorizationLifecycleReasons({
            lifecycleStatus:
              'DISABLED',

            enablementStatus:
              'ENABLED',

            tariffMembershipStatus:
              'LISTED',

            coverageType:
              'NO_PBS',

            directionStatus:
              'PENDING',

            quantity:
              '1',

            minimumQuantity:
              1,

            validityStatus:
              'INVALID_DATE',
          }),
        ).toEqual([
          {
            code:
              'INVALID_DATE',

            message:
              'Fecha de asignación o vigencia inválida',
          },
        ]);
      },
    );


    it(
      'explica direccionamiento NO PBS pendiente',
      () => {
        expect(
          resolveAuthorizationLifecycleReasons({
            lifecycleStatus:
              'PENDING',

            enablementStatus:
              'ENABLED',

            tariffMembershipStatus:
              'LISTED',

            coverageType:
              'NO_PBS',

            directionStatus:
              'PENDING',

            quantity:
              '1',

            minimumQuantity:
              1,

            validityStatus:
              'IN_WINDOW',
          }),
        ).toEqual([
          {
            code:
              'DIRECTION_PENDING',

            message:
              'Direccionamiento NO PBS pendiente',
          },
        ]);
      },
    );


    it(
      'explica fuera de horizonte de 30 días',
      () => {
        expect(
          resolveAuthorizationLifecycleReasons({
            lifecycleStatus:
              'PENDING',

            enablementStatus:
              'ENABLED',

            tariffMembershipStatus:
              'LISTED',

            coverageType:
              'PBS',

            directionStatus:
              'NOT_APPLICABLE',

            quantity:
              '1',

            minimumQuantity:
              1,

            validityStatus:
              'OUTSIDE_HORIZON',
          }),
        ).toEqual([
          {
            code:
              'OUTSIDE_HORIZON',

            message:
              'Fecha de asignación fuera de la ventana operativa de 30 días',
          },
        ]);
      },
    );


    it(
      'habilitada no tiene motivos de bloqueo',
      () => {
        expect(
          resolveAuthorizationLifecycleReasons({
            lifecycleStatus:
              'ENABLED',

            enablementStatus:
              'ENABLED',

            tariffMembershipStatus:
              'LISTED',

            coverageType:
              'PBS',

            directionStatus:
              'NOT_APPLICABLE',

            quantity:
              '2',

            minimumQuantity:
              1,

            validityStatus:
              'IN_WINDOW',
          }),
        ).toEqual([]);
      },
    );
  },
);
