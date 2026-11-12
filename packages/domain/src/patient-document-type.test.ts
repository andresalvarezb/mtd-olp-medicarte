import { describe, expect, it } from 'vitest';
import { canonicalPatientDocumentType, patientDocumentTypeAliases } from './patient-document-type';

describe('patient document type aliases', () => {
  it.each([
    ['1', 'CC'],
    ['3', 'TI'],
    ['4', 'CE'],
    ['7', 'RC'],
  ])('maps known Alto Costo code %s to %s', (code, canonical) => {
    expect(canonicalPatientDocumentType(code)).toBe(canonical);
    expect(patientDocumentTypeAliases(canonical)).toEqual([canonical, code]);
  });

  it('keeps unknown types exact and does not infer them', () => {
    expect(canonicalPatientDocumentType('PA')).toBe('PA');
    expect(canonicalPatientDocumentType(' pa ')).toBe(' pa ');
    expect(patientDocumentTypeAliases('X-UNKNOWN')).toEqual(['X-UNKNOWN']);
  });
});
