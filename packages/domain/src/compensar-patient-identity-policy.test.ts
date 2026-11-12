import { describe, expect, it } from 'vitest';
import {
  COMPENSAR_PATIENT_IDENTITY_POLICY,
  assessCompensarPatientIdentity,
  compensarDocumentTypeSourceKeys,
  normalizeCompensarDocumentType,
} from './compensar-patient-identity-policy';

describe('COMPENSAR patient identity policy', () => {
  it('maps only AUTO source type 1 to CC', () => {
    expect(normalizeCompensarDocumentType('1')).toBe('CC');
    expect(normalizeCompensarDocumentType('CC')).toBe('CC');
  });

  it('preserves the literal document value and rejects unapproved source and canonical types', () => {
    expect(COMPENSAR_PATIENT_IDENTITY_POLICY.normalizeDocumentValue('000123', 'CC')).toBe('000123');
    for (const type of ['2', '3', '4', '7', '13', 'CE', 'CD', 'PA', 'CN']) {
      expect(() => normalizeCompensarDocumentType(type)).toThrow('UNMAPPED_COMPENSAR_DOCUMENT_TYPE');
      expect(() => compensarDocumentTypeSourceKeys(type)).toThrow('UNMAPPED_COMPENSAR_DOCUMENT_TYPE');
    }
  });

  it('accepts an Excel numeric catalogue cell without changing the source or document value', () => {
    const source = { TIPO_IDENTIFICACION: 1, IDENTIFICACION_PACIENTE: '000123' };
    expect(assessCompensarPatientIdentity(source)).toMatchObject({
      state: 'VERIFIED',
      rawDocumentType: '1',
      normalizedDocumentType: 'CC',
      rawDocumentValue: '000123',
    });
    expect(source.TIPO_IDENTIFICACION).toBe(1);
    expect(compensarDocumentTypeSourceKeys('CC')).toEqual(['1', 'CC']);
    expect(compensarDocumentTypeSourceKeys('1')).toEqual(['1', 'CC']);
  });

  it('keeps a numeric document number pending because Excel may have lost leading zeros', () => {
    expect(
      assessCompensarPatientIdentity({
        TIPO_IDENTIFICACION: 1,
        IDENTIFICACION_PACIENTE: 123,
      }).state,
    ).toBe('REQUIRES_REVIEW');
  });

  it('does not treat an alphabetic AUTO source type as an approved numeric code', () => {
    expect(
      assessCompensarPatientIdentity({
        TIPO_IDENTIFICACION: 'CC',
        IDENTIFICACION_PACIENTE: '000123',
      }).state,
    ).toBe('REQUIRES_REVIEW');
  });

  it.each([2, 3, 4, 7, 9, 10, 14, 15])('keeps unapproved source code %s pending', (code) => {
    expect(
      assessCompensarPatientIdentity({
        TIPO_IDENTIFICACION: code,
        IDENTIFICACION_PACIENTE: 'PENDIENTE',
      }).state,
    ).toBe('REQUIRES_REVIEW');
  });
});
