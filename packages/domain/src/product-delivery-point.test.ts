import { describe, expect, it } from 'vitest';
import {
  normalizeDeliveryPointCode,
  normalizeInvimaComponent,
  parseCumProductIdentity,
} from './product-delivery-point';

describe('product delivery point identity', () => {
  it('normalizes INVIMA components independently of zero padding', () => {
    expect(normalizeInvimaComponent('03')).toBe('3');
    expect(normalizeInvimaComponent('003')).toBe('3');
    expect(normalizeInvimaComponent('20039088')).toBe('20039088');
    expect(normalizeInvimaComponent('00200666')).toBe('200666');
    expect(normalizeInvimaComponent('ABC')).toBeNull();
    expect(normalizeInvimaComponent('')).toBeNull();
  });

  it('extracts expediente and presentation from a complete CUM', () => {
    expect(parseCumProductIdentity('20039088-03-0S01LA05')).toEqual({
      cumCode: '20039088-03-0S01LA05',
      invimaRecord: '20039088',
      invimaPresentation: '3',
    });
  });

  it('accepts CUM identity without an additional suffix', () => {
    expect(parseCumProductIdentity('20112358-03')).toEqual({
      cumCode: '20112358-03',
      invimaRecord: '20112358',
      invimaPresentation: '3',
    });
  });

  it('rejects malformed CUM values', () => {
    expect(parseCumProductIdentity('')).toBeNull();
    expect(parseCumProductIdentity('ABC')).toBeNull();
    expect(parseCumProductIdentity('20039088')).toBeNull();
  });

  it('normalizes delivery point codes', () => {
    expect(normalizeDeliveryPointCode('CENTUM ')).toBe('CENTUM');
    expect(normalizeDeliveryPointCode('chapinero')).toBe('CHAPINERO');
    expect(normalizeDeliveryPointCode('Clínica Norte')).toBe('CLINICA_NORTE');
  });
});
