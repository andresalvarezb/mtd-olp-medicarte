import { describe, expect, it } from 'vitest';
import { decideAuthorization16Renewal as decide } from './authorization-source-renewal';

const baseline = {
  storedSourceStatus: '16', incomingSourceStatus: '16',
  previousValidityEndDate: '2026-10-01', nextValidityEndDate: '2026-11-30',
  todayBogota: '2026-10-11',
};

describe('BR-AUTO-REN-001: estado fuente efectivo tras ampliación de vigencia', () => {
  it('convierte 16 a 5 si la ampliación alcanza fecha vigente', () => {
    expect(decide(baseline)).toEqual({ effectiveSourceStatus: '5', outcome: 'PROMOTED' });
  });
  it('admite formato AAAAMMDD y fecha límite igual a hoy', () => {
    expect(decide({ ...baseline, previousValidityEndDate: '20261001', nextValidityEndDate: '20261011' }).outcome).toBe('PROMOTED');
  });
  it('no convierte fechas idénticas, anteriores o todavía vencidas', () => {
    for (const nextValidityEndDate of ['2026-10-01', '2026-09-29', '2026-10-10']) {
      expect(decide({ ...baseline, nextValidityEndDate }).outcome).toBe('UNCHANGED');
    }
  });
  it('no convierte fechas imposibles ni vigencia anterior inválida', () => {
    expect(decide({ ...baseline, nextValidityEndDate: '2026-02-30' }).outcome).toBe('UNCHANGED');
    expect(decide({ ...baseline, previousValidityEndDate: '2026-02-30' }).outcome).toBe('UNCHANGED');
  });
  it('no cambia otros estados, ni reemplaza transición explícita enviada como 5', () => {
    expect(decide({ ...baseline, storedSourceStatus: '4', incomingSourceStatus: '4' }).effectiveSourceStatus).toBe('4');
    expect(decide({ ...baseline, incomingSourceStatus: '5' }).outcome).toBe('UNCHANGED');
  });
  it('mantiene 5 cuando la recarga reenvía el 16 original con la misma o mayor vigencia', () => {
    expect(decide({ ...baseline, storedSourceStatus: '5', incomingSourceStatus: '16', previouslyRenewed: true,
      previousValidityEndDate: '2026-11-30', nextValidityEndDate: '2026-11-30' })).toEqual({ effectiveSourceStatus: '5', outcome: 'PRESERVED' });
    expect(decide({ ...baseline, storedSourceStatus: '5', incomingSourceStatus: '16', previouslyRenewed: true,
      previousValidityEndDate: '2026-11-30', nextValidityEndDate: '2026-12-01' }).outcome).toBe('PRESERVED');
  });
  it('rechaza regresión temporal de recarga de un 16 ya renovado', () => {
    expect(decide({ ...baseline, storedSourceStatus: '5', incomingSourceStatus: '16', previouslyRenewed: true,
      previousValidityEndDate: '2026-11-30', nextValidityEndDate: '2026-10-01' }).outcome).toBe('STALE_RELOAD');
  });
  it('no protege 5 sin procedencia de renovación', () => {
    expect(decide({ ...baseline, storedSourceStatus: '5', incomingSourceStatus: '16', previouslyRenewed: false }).effectiveSourceStatus).toBe('16');
  });
});
