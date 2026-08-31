import { describe, expect, it } from 'vitest';
import { currentBogotaDate, evaluateMipresVigencia, type MipresDirection } from './mipres';

function direction(overrides: Partial<MipresDirection> = {}): MipresDirection {
  return {
    externalId: 'id-1',
    directionId: 'dir-1',
    prescriptionNumber: '20260915123',
    technologyType: 'M',
    technologyConsecutive: '1',
    maximumDeliveryDate: '2030-01-31',
    externalStatus: 'ACTIVO',
    annulled: false,
    ...overrides,
  };
}

describe('currentBogotaDate', () => {
  it('maps an instant to the Colombia calendar date', () => {
    expect(currentBogotaDate(new Date('2030-02-01T02:30:00Z'))).toBe('2030-01-31');
    expect(currentBogotaDate(new Date('2030-02-01T06:30:00Z'))).toBe('2030-02-01');
  });
});

describe('evaluateMipresVigencia', () => {
  it('confirms when at least one non-annulled direction is strictly before FecMaxEnt', () => {
    const result = evaluateMipresVigencia([direction()], '2030-01-30');
    expect(result).toEqual({
      outcome: 'CONFIRMADO',
      hasCurrent: true,
      directionCount: 1,
      ruleVersion: 'F3-MIPRES-1',
    });
  });

  it('is pending when there are no directions', () => {
    expect(evaluateMipresVigencia([], '2030-01-31')).toEqual({
      outcome: 'PENDIENTE',
      hasCurrent: false,
      directionCount: 0,
      ruleVersion: 'F3-MIPRES-1',
    });
  });

  it('is pending when the only direction is annulled', () => {
    expect(evaluateMipresVigencia([direction({ annulled: true })], '2030-01-01')).toEqual({
      outcome: 'PENDIENTE',
      hasCurrent: false,
      directionCount: 1,
      ruleVersion: 'F3-MIPRES-1',
    });
  });

  it('is pending when FecMaxEnt equals the current Bogota date (equality is not valid)', () => {
    expect(evaluateMipresVigencia([direction()], '2030-01-30').outcome).toBe('CONFIRMADO');
    expect(evaluateMipresVigencia([direction()], '2030-01-31').outcome).toBe('PENDIENTE');
    expect(evaluateMipresVigencia([direction()], '2030-02-01').outcome).toBe('PENDIENTE');
  });

  it('is pending when every direction is expired or annulled', () => {
    const result = evaluateMipresVigencia(
      [direction({ maximumDeliveryDate: '2026-01-01' }), direction({ annulled: true })],
      '2030-01-31',
    );
    expect(result.outcome).toBe('PENDIENTE');
    expect(result.hasCurrent).toBe(false);
    expect(result.directionCount).toBe(2);
  });
});
