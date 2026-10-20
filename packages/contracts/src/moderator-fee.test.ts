import { describe, expect, it } from 'vitest';

import {
  registerModeratorFeeRequestSchema,
} from './moderator-fee';

const base = {
  idempotencyKey:
    '10000000-0000-4000-8000-000000000001',
  expectedVersion: 0,
};

describe('Cuota moderadora - contrato de recaudo', () => {
  it('acepta un recaudo confirmado válido', () => {
    const result = registerModeratorFeeRequestSchema.safeParse({
      ...base,
      status: 'COLLECTED',
      amountCop: '12500.00',
      collectedAt: '2026-10-17T11:00:00-05:00',
    });

    expect(result.success).toBe(true);
  });

  it('acepta informar expresamente que no se recaudó', () => {
    const result = registerModeratorFeeRequestSchema.safeParse({
      ...base,
      status: 'NOT_COLLECTED',
    });

    expect(result.success).toBe(true);
  });

  it('rechaza recaudos sin fecha o valor', () => {
    const result = registerModeratorFeeRequestSchema.safeParse({
      ...base,
      status: 'COLLECTED',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza valor cero o negativo', () => {
    for (const amountCop of ['0', '-100', '0.00']) {
      expect(
        registerModeratorFeeRequestSchema.safeParse({
          ...base,
          status: 'COLLECTED',
          amountCop,
          collectedAt: '2026-10-17T11:00:00-05:00',
        }).success,
      ).toBe(false);
    }
  });

  it('no permite registrar importe como NO RECAUDADA', () => {
    const result = registerModeratorFeeRequestSchema.safeParse({
      ...base,
      status: 'NOT_COLLECTED',
      amountCop: '1000',
    });

    expect(result.success).toBe(false);
  });

  it('exige clave de idempotencia válida', () => {
    const result = registerModeratorFeeRequestSchema.safeParse({
      ...base,
      idempotencyKey: 'reintento',
      status: 'NOT_COLLECTED',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una versión negativa', () => {
    const result = registerModeratorFeeRequestSchema.safeParse({
      ...base,
      expectedVersion: -1,
      status: 'NOT_COLLECTED',
    });

    expect(result.success).toBe(false);
  });
});
