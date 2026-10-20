import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  calculateUnassignedAvailability,
  calculateAssignableAvailability,
  calculateUncommittedPurchaseBalance,
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

describe('OC + producto: saldo global y saldo por punto', () => {
  it('no permite reutilizar en CENTUM las 110 entregas y 34 reservas de la OC 9198/10777', () => {
    expect(calculateAssignableAvailability(145, 38, 0, 145, 110, 34)).toBe(1);
  });

  it('bloquea RC0067 aun cuando CHAPINERO muestre saldo aislado', () => {
    expect(calculateAssignableAvailability(25, 2, 14, 25, 11, 14)).toBe(0);
  });

  it('permite hasta las 4 unidades de GH0034 y las 2 de cada OC 10832', () => {
    expect(calculateAssignableAvailability(108, 75, 29, 108, 75, 29)).toBe(4);
    expect(calculateAssignableAvailability(35, 26, 7, 35, 26, 7)).toBe(2);
    expect(calculateAssignableAvailability(46, 9, 35, 46, 9, 35)).toBe(2);
  });

  it('nunca libera el saldo si se incumple el limite del punto', () => {
    expect(calculateAssignableAvailability(2, 0, 2, 100, 0, 0)).toBe(0);
  });
});

describe('saldo OC pendiente sin comprometer', () => {
  it('libera capacidad de compra sin inventar stock', () => {
    expect(calculateUncommittedPurchaseBalance(10, 6, 10)).toBe(0);
    expect(calculateUncommittedPurchaseBalance(10, 6, 0)).toBe(4);
  });

  it('no descuenta dos veces una reserva y su fuente', () => {
    expect(calculateUncommittedPurchaseBalance(10, 6, 6)).toBe(4);
    expect(calculateUncommittedPurchaseBalance(10, 6, 8)).toBe(2);
  });

  it('respeta la cantidad comprada y no produce negativos', () => {
    expect(calculateUncommittedPurchaseBalance(10, 0, 6)).toBe(4);
    expect(calculateUncommittedPurchaseBalance(10, 0, 12)).toBe(0);
    expect(calculateUncommittedPurchaseBalance(3, 5, 0)).toBe(0);
  });
});
