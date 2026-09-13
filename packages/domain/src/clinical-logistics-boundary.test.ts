import { describe, expect, it } from 'vitest';
import {
  LEGACY_OPERATIONAL_FIELDS,
  createClinicalAuthorizationReference,
  isLegacyOperationalField,
  normalizeCommercialCode,
} from './clinical-logistics-boundary';

describe('clinical/logistics boundary', () => {
  it('normalizes commercial codes without assigning physical ownership', () => {
    expect(
      createClinicalAuthorizationReference({
        authorizationItemId: 'item-1',
        commercialCode: ' cod001 ',
      }),
    ).toEqual({ authorizationItemId: 'item-1', commercialCode: 'COD001' });
  });

  it('rejects an empty commercial code', () => {
    expect(() => normalizeCommercialCode('   ')).toThrow('Commercial code is required');
  });

  it('keeps legacy operational fields explicit and identifiable', () => {
    expect(LEGACY_OPERATIONAL_FIELDS).toContain('orden_compra');
    expect(isLegacyOperationalField('orden_compra')).toBe(true);
    expect(isLegacyOperationalField('commercial_code')).toBe(false);
  });
});
