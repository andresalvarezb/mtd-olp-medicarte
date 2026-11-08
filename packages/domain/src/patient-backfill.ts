import { assessPatientIdentity, type PatientIdentityNormalizationPolicy } from './patient-identity';

export type PatientBackfillInventoryRow = Readonly<{
  authorizationItemId: string;
  organizationCodes: readonly string[];
  sourceData: unknown;
  patientId: string | null;
  exactCandidatePatientCount?: number;
  linkedPatient: Readonly<{
    identificationTypeRaw: string;
    identificationValueRaw: string;
  }> | null;
}>;

export type PatientBackfillReport = Readonly<{
  scanned: number;
  outOfScope: number;
  identityComplete: number;
  identityIncomplete: number;
  identityContradictory: number;
  identityRequiresReview: number;
  identityPolicyRequired: number;
  repeatedExactCompositeGroups: number;
  repeatedAuthorizationRows: number;
  sameDocumentDifferentTypeGroups: number;
  unlinkedExistingPatientMatches: number;
  unlinkedMultiplePatientMatches: number;
  linked: number;
  linkedIdentityMatches: number;
  linkedIdentityDiscrepancies: number;
  linkedPatientMissing: number;
  eligibleForBackfill: number;
}>;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;

function rawIdentityKey(type: string, value: string): string {
  return JSON.stringify([type, value]);
}

/**
 * Returns aggregate-only counts. Raw identities and authorization ids are
 * retained only in this invocation's memory and never enter the report.
 */
export function buildPatientBackfillInventory(
  rows: readonly PatientBackfillInventoryRow[],
  policy?: PatientIdentityNormalizationPolicy,
): PatientBackfillReport {
  const report = {
    scanned: rows.length,
    outOfScope: 0,
    identityComplete: 0,
    identityIncomplete: 0,
    identityContradictory: 0,
    identityRequiresReview: 0,
    identityPolicyRequired: 0,
    repeatedExactCompositeGroups: 0,
    repeatedAuthorizationRows: 0,
    sameDocumentDifferentTypeGroups: 0,
    unlinkedExistingPatientMatches: 0,
    unlinkedMultiplePatientMatches: 0,
    linked: 0,
    linkedIdentityMatches: 0,
    linkedIdentityDiscrepancies: 0,
    linkedPatientMissing: 0,
    eligibleForBackfill: 0,
  };
  const exactCompositeRows = new Map<string, number>();
  const documentTypesByValue = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.organizationCodes.includes('MEDICARTE')) {
      report.outOfScope += 1;
      continue;
    }
    const source = asRecord(row.sourceData) ?? {};
    const assessment = assessPatientIdentity(source, policy);
    if (assessment.state === 'INCOMPLETE') report.identityIncomplete += 1;
    else if (assessment.state === 'CONTRADICTORY') report.identityContradictory += 1;
    else if (assessment.state === 'REQUIRES_REVIEW') report.identityRequiresReview += 1;
    else if (assessment.state === 'POLICY_REQUIRED') {
      report.identityComplete += 1;
      report.identityPolicyRequired += 1;
    } else {
      report.identityComplete += 1;
    }
    if (assessment.state === 'VERIFIED' || assessment.state === 'POLICY_REQUIRED') {
      const groupType =
        assessment.state === 'VERIFIED'
          ? assessment.normalizedDocumentType
          : assessment.rawDocumentType;
      const groupValue =
        assessment.state === 'VERIFIED'
          ? assessment.normalizedDocumentValue
          : assessment.rawDocumentValue;
      const key = rawIdentityKey(groupType, groupValue);
      exactCompositeRows.set(key, (exactCompositeRows.get(key) ?? 0) + 1);
      const types = documentTypesByValue.get(groupValue) ?? new Set<string>();
      types.add(groupType);
      documentTypesByValue.set(groupValue, types);
    }

    if (!row.patientId) {
      const candidateCount = row.exactCandidatePatientCount ?? 0;
      if (candidateCount === 1) report.unlinkedExistingPatientMatches += 1;
      if (candidateCount > 1) report.unlinkedMultiplePatientMatches += 1;
      if (assessment.state === 'VERIFIED' && candidateCount < 2) report.eligibleForBackfill += 1;
      continue;
    }
    report.linked += 1;
    if (!row.linkedPatient) {
      report.linkedPatientMissing += 1;
      report.linkedIdentityDiscrepancies += 1;
      continue;
    }
    if (
      assessment.state === 'POLICY_REQUIRED' &&
      row.linkedPatient.identificationTypeRaw === assessment.rawDocumentType &&
      row.linkedPatient.identificationValueRaw === assessment.rawDocumentValue
    ) {
      report.linkedIdentityMatches += 1;
      continue;
    }
    if (assessment.state !== 'VERIFIED') {
      report.linkedIdentityDiscrepancies += 1;
      continue;
    }
    const linked = assessPatientIdentity(
      {
        TIPO_IDENTIFICACION: row.linkedPatient.identificationTypeRaw,
        IDENTIFICACION_PACIENTE: row.linkedPatient.identificationValueRaw,
      },
      policy,
    );
    if (
      linked.state === 'VERIFIED' &&
      linked.policyVersion === assessment.policyVersion &&
      linked.normalizedDocumentType === assessment.normalizedDocumentType &&
      linked.normalizedDocumentValue === assessment.normalizedDocumentValue
    )
      report.linkedIdentityMatches += 1;
    else report.linkedIdentityDiscrepancies += 1;
  }

  for (const count of exactCompositeRows.values()) {
    if (count > 1) {
      report.repeatedExactCompositeGroups += 1;
      report.repeatedAuthorizationRows += count;
    }
  }
  report.sameDocumentDifferentTypeGroups = [...documentTypesByValue.values()].filter(
    (types) => types.size > 1,
  ).length;
  return report;
}

export type PatientBackfillDecision = Readonly<{
  status: 'ELIGIBLE' | 'ALREADY_LINKED' | 'NEEDS_RECONCILIATION' | 'OUT_OF_SCOPE';
  reasonCode:
    | 'IDENTITY_VERIFIED'
    | 'ALREADY_LINKED_MATCH'
    | 'IDENTITY_INCOMPLETE'
    | 'IDENTITY_CONTRADICTORY'
    | 'IDENTITY_REQUIRES_REVIEW'
    | 'IDENTITY_POLICY_REQUIRED'
    | 'LINKED_PATIENT_MISSING'
    | 'LINKED_IDENTITY_DISCREPANCY'
    | 'OUT_OF_SCOPE';
}>;

/** Classifies one source row without returning or persisting source identity. */
export function classifyPatientBackfillRow(
  row: PatientBackfillInventoryRow,
  policy: PatientIdentityNormalizationPolicy,
): PatientBackfillDecision {
  if (!row.organizationCodes.includes('MEDICARTE')) {
    return { status: 'OUT_OF_SCOPE', reasonCode: 'OUT_OF_SCOPE' };
  }
  const source = asRecord(row.sourceData) ?? {};
  const identity = assessPatientIdentity(source, policy);
  if (identity.state === 'INCOMPLETE') {
    return { status: 'NEEDS_RECONCILIATION', reasonCode: 'IDENTITY_INCOMPLETE' };
  }
  if (identity.state === 'CONTRADICTORY') {
    return { status: 'NEEDS_RECONCILIATION', reasonCode: 'IDENTITY_CONTRADICTORY' };
  }
  if (identity.state === 'REQUIRES_REVIEW') {
    return { status: 'NEEDS_RECONCILIATION', reasonCode: 'IDENTITY_REQUIRES_REVIEW' };
  }
  if (identity.state === 'POLICY_REQUIRED') {
    return { status: 'NEEDS_RECONCILIATION', reasonCode: 'IDENTITY_POLICY_REQUIRED' };
  }
  if (!row.patientId) return { status: 'ELIGIBLE', reasonCode: 'IDENTITY_VERIFIED' };
  if (!row.linkedPatient) {
    return { status: 'NEEDS_RECONCILIATION', reasonCode: 'LINKED_PATIENT_MISSING' };
  }
  const linked = assessPatientIdentity(
    {
      TIPO_IDENTIFICACION: row.linkedPatient.identificationTypeRaw,
      IDENTIFICACION_PACIENTE: row.linkedPatient.identificationValueRaw,
    },
    policy,
  );
  if (
    linked.state === 'VERIFIED' &&
    linked.policyVersion === identity.policyVersion &&
    linked.normalizedDocumentType === identity.normalizedDocumentType &&
    linked.normalizedDocumentValue === identity.normalizedDocumentValue
  )
    return { status: 'ALREADY_LINKED', reasonCode: 'ALREADY_LINKED_MATCH' };
  return { status: 'NEEDS_RECONCILIATION', reasonCode: 'LINKED_IDENTITY_DISCREPANCY' };
}
