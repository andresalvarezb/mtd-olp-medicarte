import { describe, expect, it } from 'vitest';
import {
  buildPatientBackfillInventory,
  classifyPatientBackfillRow,
  type PatientBackfillInventoryRow,
} from './patient-backfill';
import type { PatientIdentityNormalizationPolicy } from './patient-identity';

const policy: PatientIdentityNormalizationPolicy = {
  version: 'SYNTHETIC_EXACT_TEST_V1',
  normalizeDocumentType: (value) => value,
  normalizeDocumentValue: (value) => value,
};

function row(overrides: Partial<PatientBackfillInventoryRow> = {}): PatientBackfillInventoryRow {
  return {
    authorizationItemId: 'auth-synthetic-1',
    organizationCodes: ['MEDICARTE'],
    sourceData: { TIPO_IDENTIFICACION: 'CC', IDENTIFICACION_PACIENTE: 'DOC-SYN-1' },
    patientId: null,
    linkedPatient: null,
    ...overrides,
  };
}

describe('patient backfill inventory and decisions', () => {
  it('counts repeated authorizations as one composite identity and keeps document types distinct', () => {
    const report = buildPatientBackfillInventory(
      [
        row(),
        row({ authorizationItemId: 'auth-synthetic-2' }),
        row({
          authorizationItemId: 'auth-synthetic-3',
          sourceData: {
            TIPO_IDENTIFICACION: 'CE',
            IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
          },
        }),
      ],
      policy,
    );

    expect(report.identityComplete).toBe(3);
    expect(report.repeatedExactCompositeGroups).toBe(1);
    expect(report.repeatedAuthorizationRows).toBe(2);
    expect(report.sameDocumentDifferentTypeGroups).toBe(1);
    expect(JSON.stringify(report)).not.toContain('DOC-SYN-1');
  });

  it('recognizes both historical aliases and reports conflicting source columns', () => {
    const report = buildPatientBackfillInventory(
      [
        row({ sourceData: { TIPO_IDENTIFICACION: 'CC', NUM_DOCUMENTO: 'DOC-SYN-1' } }),
        row({
          authorizationItemId: 'auth-synthetic-2',
          sourceData: {
            TIPO_IDENTIFICACION: 'CC',
            IDENTIFICACION_PACIENTE: 'DOC-SYN-1',
            NUM_DOCUMENTO: 'DOC-SYN-2',
          },
        }),
        row({ authorizationItemId: 'auth-synthetic-3', sourceData: { TIPO_IDENTIFICACION: 'CC' } }),
      ],
      policy,
    );

    expect(report.identityComplete).toBe(1);
    expect(report.identityContradictory).toBe(1);
    expect(report.identityIncomplete).toBe(1);
    expect(report.eligibleForBackfill).toBe(1);
  });

  it('requires an explicit policy before calling a complete identity eligible', () => {
    const report = buildPatientBackfillInventory([
      row(),
      row({ authorizationItemId: 'auth-synthetic-2' }),
    ]);
    expect(report.identityComplete).toBe(2);
    expect(report.identityPolicyRequired).toBe(2);
    expect(report.eligibleForBackfill).toBe(0);
    expect(report.repeatedExactCompositeGroups).toBe(1);
    expect(classifyPatientBackfillRow(row(), policy)).toEqual({
      status: 'ELIGIBLE',
      reasonCode: 'IDENTITY_VERIFIED',
    });
  });

  it('reports exact existing candidates and excludes duplicate local patients from auto-link eligibility', () => {
    const report = buildPatientBackfillInventory(
      [
        row({ exactCandidatePatientCount: 1 }),
        row({ authorizationItemId: 'auth-synthetic-2', exactCandidatePatientCount: 2 }),
      ],
      policy,
    );
    expect(report.unlinkedExistingPatientMatches).toBe(1);
    expect(report.unlinkedMultiplePatientMatches).toBe(1);
    expect(report.eligibleForBackfill).toBe(1);
  });

  it('detects linked matches, discrepancies, and missing linked patients without changing links', () => {
    const report = buildPatientBackfillInventory(
      [
        row({
          patientId: 'patient-1',
          linkedPatient: {
            identificationTypeRaw: 'CC',
            identificationValueRaw: 'DOC-SYN-1',
          },
        }),
        row({
          authorizationItemId: 'auth-synthetic-2',
          patientId: 'patient-2',
          linkedPatient: {
            identificationTypeRaw: 'CE',
            identificationValueRaw: 'DOC-SYN-1',
          },
        }),
        row({ authorizationItemId: 'auth-synthetic-3', patientId: 'patient-3' }),
      ],
      policy,
    );

    expect(report.linked).toBe(3);
    expect(report.linkedIdentityMatches).toBe(1);
    expect(report.linkedIdentityDiscrepancies).toBe(2);
    expect(report.linkedPatientMissing).toBe(1);
  });

  it('excludes rows outside the verified Medicarte organization relation', () => {
    const input = row({ organizationCodes: ['MTD'] });
    expect(buildPatientBackfillInventory([input], policy)).toMatchObject({
      outOfScope: 1,
      eligibleForBackfill: 0,
    });
    expect(classifyPatientBackfillRow(input, policy).status).toBe('OUT_OF_SCOPE');
  });
});
