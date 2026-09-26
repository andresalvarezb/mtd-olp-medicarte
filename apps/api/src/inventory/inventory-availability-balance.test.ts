import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  calculateUnassignedAvailability,
} from './inventory-availability-balance';

describe(
  'inventory availability balance',
  () => {
    it(
      'descuenta el saldo asignado activo de la disponibilidad',
      () => {
        expect(
          calculateUnassignedAvailability(
            10,
            2,
            5,
          ),
        ).toBe(3);
      },
    );

    it(
      'devuelve el saldo a disponibilidad al liberar la asignacion',
      () => {
        expect(
          calculateUnassignedAvailability(
            10,
            2,
            0,
          ),
        ).toBe(8);
      },
    );

    it(
      'nunca expone disponibilidad negativa',
      () => {
        expect(
          calculateUnassignedAvailability(
            3,
            2,
            5,
          ),
        ).toBe(0);
      },
    );
  },
);
