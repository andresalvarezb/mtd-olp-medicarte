import { describe, expect, it } from 'vitest';
import { canonicalPatientDocumentType, patientDocumentTypeAliases } from './patient-document-type';

describe('patient document type aliases', () => {
  it('maps only approved Alto Costo code 1 to CC', () => {
    expect(canonicalPatientDocumentType('1')).toBe('CC');
    expect(patientDocumentTypeAliases('CC')).toEqual(['CC', '1']);
  });

  it.each(['3', '4', '7'])('does not infer an unapproved type from code %s', (code) => {
    expect(canonicalPatientDocumentType(code)).toBe(code);
    expect(patientDocumentTypeAliases(code)).toEqual([code]);
  });

  it('keeps unknown types exact and does not infer them', () => {
    expect(canonicalPatientDocumentType('PA')).toBe('PA');
    expect(canonicalPatientDocumentType(' pa ')).toBe(' pa ');
    expect(patientDocumentTypeAliases('X-UNKNOWN')).toEqual(['X-UNKNOWN']);
  });
});
