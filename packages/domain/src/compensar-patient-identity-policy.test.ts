import { describe, expect, it } from 'vitest';
import {
  COMPENSAR_PATIENT_IDENTITY_POLICY,
  assessCompensarPatientIdentity,
  compensarDocumentTypeSourceKeys,
  normalizeCompensarDocumentType,
} from './compensar-patient-identity-policy';

describe('COMPENSAR patient identity policy', () => {
  it('maps approved AUTO document types to canonical MTDOM types', () => {
    expect(normalizeCompensarDocumentType('1')).toBe('CC');
    expect(normalizeCompensarDocumentType('3')).toBe('TI');
    expect(normalizeCompensarDocumentType('7')).toBe('RC');
    expect(normalizeCompensarDocumentType('4')).toBe('CE');
    expect(normalizeCompensarDocumentType('14')).toBe('PE');
    expect(normalizeCompensarDocumentType('CC')).toBe('CC');
  });

  it('preserves the literal document value and rejects unapproved source and canonical types', () => {
    expect(COMPENSAR_PATIENT_IDENTITY_POLICY.normalizeDocumentValue('000123', 'CC')).toBe('000123');
    for (const type of ['2', '5', '6', '8', '9', '10', '11', '12', '13', '15', 'CD', 'PA', 'CN']) {
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
    expect(compensarDocumentTypeSourceKeys('TI')).toEqual(['3', 'TI']);
    expect(compensarDocumentTypeSourceKeys('RC')).toEqual(['7', 'RC']);
    expect(compensarDocumentTypeSourceKeys('CE')).toEqual(['4', 'CE']);
    expect(compensarDocumentTypeSourceKeys('PE')).toEqual(['14', 'PE']);
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

  it.each([2, 5, 6, 8, 9, 10, 11, 12, 13, 15])('keeps unapproved source code %s pending', (code) => {
    expect(
      assessCompensarPatientIdentity({
        TIPO_IDENTIFICACION: code,
        IDENTIFICACION_PACIENTE: 'PENDIENTE',
      }).state,
    ).toBe('REQUIRES_REVIEW');
  });
});
