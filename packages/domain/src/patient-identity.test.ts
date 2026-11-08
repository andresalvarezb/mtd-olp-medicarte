import { describe, expect, it } from 'vitest';
import {
  assessPatientIdentity,
  compareVerifiedPatientIdentities,
  type PatientIdentityNormalizationPolicy,
} from './patient-identity';

const completeSource = {
  TIPO_IDENTIFICACION: 'CC',
  IDENTIFICACION_PACIENTE: '000-123',
};

// Test-only policy: it exists to exercise explicit injection, not to approve
// these transformations for Medicarte or MTDOM.
const testOnlyPolicy: PatientIdentityNormalizationPolicy = {
  version: 'TEST_ONLY_V1',
  normalizeDocumentType: (rawValue) => rawValue.trim().toUpperCase(),
  normalizeDocumentValue: (rawValue) => rawValue,
};

const testOnlyPolicyV2: PatientIdentityNormalizationPolicy = {
  ...testOnlyPolicy,
  version: 'TEST_ONLY_V2',
};

describe('patient identity assessment before normalization approval', () => {
  it('keeps a complete raw pair pending when no approved policy is supplied', () => {
    expect(assessPatientIdentity(completeSource)).toEqual({
      state: 'POLICY_REQUIRED',
      rawDocumentType: 'CC',
      rawDocumentValue: '000-123',
    });
  });

  it('classifies missing components as incomplete without constructing a key', () => {
    expect(assessPatientIdentity({ TIPO_IDENTIFICACION: 'CC' })).toEqual({
      state: 'INCOMPLETE',
      missing: ['documentValue'],
    });
    expect(assessPatientIdentity({ IDENTIFICACION_PACIENTE: '000123' })).toEqual({
      state: 'INCOMPLETE',
      missing: ['documentType'],
    });
  });

  it('does not coerce a numeric cell that may have lost leading zeros', () => {
    expect(
      assessPatientIdentity({ TIPO_IDENTIFICACION: 'CC', IDENTIFICACION_PACIENTE: 123 }),
    ).toEqual({
      state: 'REQUIRES_REVIEW',
      field: 'documentValue',
      reason: 'NON_STRING_SOURCE_VALUE',
    });
  });

  it('flags disagreement between canonical and retained legacy document fields', () => {
    expect(
      assessPatientIdentity({
        ...completeSource,
        NUM_DOCUMENTO: '000123',
      }),
    ).toEqual({
      state: 'CONTRADICTORY',
      field: 'documentValue',
      reason: 'CANONICAL_AND_LEGACY_VALUES_DIFFER',
    });
  });

  it('accepts identical canonical and legacy raw values without rewriting them', () => {
    expect(
      assessPatientIdentity({
        ...completeSource,
        NUM_DOCUMENTO: '000-123',
      }),
    ).toMatchObject({
      state: 'POLICY_REQUIRED',
      rawDocumentValue: '000-123',
    });
  });

  it('applies normalization only when an explicit policy is passed', () => {
    expect(
      assessPatientIdentity({ ...completeSource, TIPO_IDENTIFICACION: ' cc ' }, testOnlyPolicy),
    ).toMatchObject({
      state: 'VERIFIED',
      policyVersion: 'TEST_ONLY_V1',
      rawDocumentType: ' cc ',
      normalizedDocumentType: 'CC',
      rawDocumentValue: '000-123',
      normalizedDocumentValue: '000-123',
    });
  });

  it('keeps document type in the composite candidate, so equal numbers of different types differ', () => {
    const first = assessPatientIdentity(completeSource, testOnlyPolicy);
    const second = assessPatientIdentity(
      { ...completeSource, TIPO_IDENTIFICACION: 'CE' },
      testOnlyPolicy,
    );
    expect(first).toMatchObject({ state: 'VERIFIED', normalizedDocumentValue: '000-123' });
    expect(second).toMatchObject({ state: 'VERIFIED', normalizedDocumentValue: '000-123' });
    if (first.state !== 'VERIFIED' || second.state !== 'VERIFIED')
      throw new Error('fixture invalid');
    expect(first.normalizedDocumentType).not.toBe(second.normalizedDocumentType);
    expect(compareVerifiedPatientIdentities(first, second)).toBe('DIFFERENT_IDENTITY');
  });

  it('identifies a reusable patient only when the approved composite candidate matches', () => {
    const existing = assessPatientIdentity(completeSource, testOnlyPolicy);
    const reimported = assessPatientIdentity({ ...completeSource }, testOnlyPolicy);
    expect(compareVerifiedPatientIdentities(existing, reimported)).toBe('SAME_IDENTITY');
    expect(compareVerifiedPatientIdentities(assessPatientIdentity(completeSource), existing)).toBe(
      'NOT_VERIFIED',
    );
  });

  it('does not compare candidates produced under different policy versions', () => {
    const previous = assessPatientIdentity(completeSource, testOnlyPolicy);
    const current = assessPatientIdentity(completeSource, testOnlyPolicyV2);
    expect(compareVerifiedPatientIdentities(previous, current)).toBe('POLICY_VERSION_MISMATCH');
  });

  it('produces a deterministic candidate for concurrent evaluations without claiming DB race safety', async () => {
    const assessments = await Promise.all(
      Array.from({ length: 16 }, () => assessPatientIdentity(completeSource, testOnlyPolicy)),
    );
    expect(new Set(assessments.map((assessment) => JSON.stringify(assessment))).size).toBe(1);
  });
});
