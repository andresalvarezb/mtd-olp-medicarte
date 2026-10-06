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
      'tarifa pendiente no mezcla bloqueo MIPRES en motivos de Habilitacion',
      () => {
        expect(
          resolveAuthorizationLifecycleReasons({
            lifecycleStatus:
              'PENDING',

            enablementStatus:
              'ENABLED',

            tariffMembershipStatus:
              'NOT_EVALUATED',

            coverageType:
              'NO_PBS',

            directionStatus:
              'PENDING',

            mipresManualDecision:
              'PENDING_MANUAL_ENABLEMENT',

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
              'TARIFF_VALIDATION_PENDING',

            message:
              'Validación del producto en Anexo Tarifario pendiente',
          },
        ]);
      },
    );


    it(
      'fecha invalida no mezcla bloqueo MIPRES en motivos de Habilitacion',
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
              'CONFIRMED',

            mipresManualDecision:
              'MANUALLY_DISABLED',

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
      'fuera de horizonte no mezcla bloqueo MIPRES en motivos de Habilitacion',
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
              'QUERY_ERROR',

            mipresManualDecision:
              'PENDING_MANUAL_ENABLEMENT',

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
