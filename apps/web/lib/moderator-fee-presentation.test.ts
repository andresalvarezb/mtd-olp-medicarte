import { describe, expect, it } from 'vitest';

import {
  moderatorFeeBalances,
  moderatorFeeCollectionDateIso,
  moderatorFeeDate,
  normalizeModeratorFeeAmount,
} from './moderator-fee-presentation';

describe('Presentación de cuota moderadora', () => {
  it('muestra cuota pendiente completa cuando no existe recaudo', () => {
    expect(moderatorFeeBalances({
      expectedAmountCop: '50000.00', amountCop: null, status: 'NOT_RECORDED',
    })).toEqual({ expected: 50000, collected: 0, pending: 50000 });
  });

  it('muestra cuota pendiente tras registrar NO RECAUDADO', () => {
    expect(moderatorFeeBalances({
      expectedAmountCop: '50000', amountCop: null, status: 'NOT_COLLECTED',
    })).toEqual({ expected: 50000, collected: 0, pending: 50000 });
  });

  it('usa solo el último estado, no suma los eventos históricos', () => {
    expect(moderatorFeeBalances({
      expectedAmountCop: '50000', amountCop: '50000.00', status: 'COLLECTED',
    })).toEqual({ expected: 50000, collected: 50000, pending: 0 });
  });

  it('evita saldos negativos y conserva centavos exactos', () => {
    expect(moderatorFeeBalances({
      expectedAmountCop: '100.10', amountCop: '100.09', status: 'COLLECTED',
    }).pending).toBe(0.01);
    expect(moderatorFeeBalances({
      expectedAmountCop: '100', amountCop: '125', status: 'COLLECTED',
    }).pending).toBe(0);
  });

  it('no inventa saldo si falta el valor de origen', () => {
    expect(moderatorFeeBalances({
      expectedAmountCop: null, amountCop: null, status: 'NOT_RECORDED',
    }).pending).toBeNull();
  });

  it('normaliza importe COP y rechaza abonos incorrectamente expresados', () => {
    expect(normalizeModeratorFeeAmount('12500')).toBe('12500.00');
    expect(normalizeModeratorFeeAmount('12500.50')).toBe('12500.50');
    expect(normalizeModeratorFeeAmount('0')).toBeNull();
    expect(normalizeModeratorFeeAmount('1e3')).toBeNull();
    expect(normalizeModeratorFeeAmount('12500.123')).toBeNull();
  });

  it('convierte fecha sin hora al inicio del día de Colombia', () => {
    expect(moderatorFeeCollectionDateIso('2026-10-17'))
      .toBe('2026-10-17T05:00:00.000Z');
    expect(moderatorFeeDate('2026-10-17T05:00:00.000Z'))
      .toMatch(/17\D+10\D+2026/);
  });

  it('rechaza fechas inexistentes y futuras', () => {
    expect(moderatorFeeCollectionDateIso('2026-02-30')).toBeNull();
    expect(moderatorFeeCollectionDateIso('2099-01-01')).toBeNull();
  });
});
