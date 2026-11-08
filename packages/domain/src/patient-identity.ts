/**
 * Clasificación pura de identidad de autorización.
 *
 * No contiene una regla de normalización predeterminada: la política debe ser
 * aprobada e inyectada por quien use este módulo. Los resultados contienen
 * valores de identificación y nunca deben escribirse en logs.
 */
export type PatientIdentityNormalizationPolicy = Readonly<{
  version: string;
  normalizeDocumentType: (rawValue: string) => string;
  normalizeDocumentValue: (rawValue: string, normalizedType: string) => string;
}>;

export type PatientIdentityAssessment =
  | Readonly<{
      state: 'INCOMPLETE';
      missing: readonly ('documentType' | 'documentValue')[];
    }>
  | Readonly<{
      state: 'CONTRADICTORY';
      field: 'documentValue';
      reason: 'CANONICAL_AND_LEGACY_VALUES_DIFFER';
    }>
  | Readonly<{
      state: 'REQUIRES_REVIEW';
      field: 'documentType' | 'documentValue';
      reason: 'NON_STRING_SOURCE_VALUE' | 'INVALID_POLICY_OUTPUT';
    }>
  | Readonly<{
      state: 'POLICY_REQUIRED';
      rawDocumentType: string;
      rawDocumentValue: string;
    }>
  | Readonly<{
      state: 'VERIFIED';
      policyVersion: string;
      rawDocumentType: string;
      rawDocumentValue: string;
      normalizedDocumentType: string;
      normalizedDocumentValue: string;
    }>;

type FieldValue = Readonly<{ kind: 'VALUE'; rawValue: string }> | Readonly<{ kind: 'MISSING' }>;

function readStringField(
  value: unknown,
  field: 'documentType' | 'documentValue',
): FieldValue | Extract<PatientIdentityAssessment, { state: 'REQUIRES_REVIEW' }> {
  if (value === undefined || value === null) return { kind: 'MISSING' };
  if (typeof value !== 'string') {
    return { state: 'REQUIRES_REVIEW', field, reason: 'NON_STRING_SOURCE_VALUE' };
  }
  if (value.trim() === '') return { kind: 'MISSING' };
  return { kind: 'VALUE', rawValue: value };
}

/**
 * Reads the canonical source_data key plus the historical alias preserved by
 * older rows. No trimming, case folding, digit conversion, or alias mapping is
 * applied to identity values.
 */
export function assessPatientIdentity(
  source: Readonly<Record<string, unknown>>,
  policy?: PatientIdentityNormalizationPolicy,
): PatientIdentityAssessment {
  const documentType = readStringField(source.TIPO_IDENTIFICACION, 'documentType');
  if ('state' in documentType) return documentType;

  const canonicalDocument = readStringField(source.IDENTIFICACION_PACIENTE, 'documentValue');
  if ('state' in canonicalDocument) return canonicalDocument;

  const legacyDocument = readStringField(source.NUM_DOCUMENTO, 'documentValue');
  if ('state' in legacyDocument) return legacyDocument;

  if (
    canonicalDocument.kind === 'VALUE' &&
    legacyDocument.kind === 'VALUE' &&
    canonicalDocument.rawValue !== legacyDocument.rawValue
  ) {
    return {
      state: 'CONTRADICTORY',
      field: 'documentValue',
      reason: 'CANONICAL_AND_LEGACY_VALUES_DIFFER',
    };
  }

  const documentValue = canonicalDocument.kind === 'VALUE' ? canonicalDocument : legacyDocument;
  const missing: ('documentType' | 'documentValue')[] = [];
  if (documentType.kind === 'MISSING') missing.push('documentType');
  if (documentValue.kind === 'MISSING') missing.push('documentValue');
  if (missing.length > 0) return { state: 'INCOMPLETE', missing };
  if (documentType.kind !== 'VALUE' || documentValue.kind !== 'VALUE') {
    return { state: 'INCOMPLETE', missing: ['documentType', 'documentValue'] };
  }

  const rawDocumentType = documentType.rawValue;
  const rawDocumentValue = documentValue.rawValue;
  if (!policy) return { state: 'POLICY_REQUIRED', rawDocumentType, rawDocumentValue };

  let normalizedDocumentType: string;
  let normalizedDocumentValue: string;
  try {
    normalizedDocumentType = policy.normalizeDocumentType(rawDocumentType);
    normalizedDocumentValue = policy.normalizeDocumentValue(
      rawDocumentValue,
      normalizedDocumentType,
    );
  } catch {
    return { state: 'REQUIRES_REVIEW', field: 'documentValue', reason: 'INVALID_POLICY_OUTPUT' };
  }

  if (
    typeof policy.version !== 'string' ||
    policy.version.trim() === '' ||
    typeof normalizedDocumentType !== 'string' ||
    normalizedDocumentType.trim() === ''
  ) {
    return { state: 'REQUIRES_REVIEW', field: 'documentType', reason: 'INVALID_POLICY_OUTPUT' };
  }
  if (typeof normalizedDocumentValue !== 'string' || normalizedDocumentValue.trim() === '') {
    return { state: 'REQUIRES_REVIEW', field: 'documentValue', reason: 'INVALID_POLICY_OUTPUT' };
  }

  return {
    state: 'VERIFIED',
    policyVersion: policy.version,
    rawDocumentType,
    rawDocumentValue,
    normalizedDocumentType,
    normalizedDocumentValue,
  };
}

/** Compares only candidates verified under an explicitly supplied policy. */
export function compareVerifiedPatientIdentities(
  left: PatientIdentityAssessment,
  right: PatientIdentityAssessment,
): 'SAME_IDENTITY' | 'DIFFERENT_IDENTITY' | 'NOT_VERIFIED' | 'POLICY_VERSION_MISMATCH' {
  if (left.state !== 'VERIFIED' || right.state !== 'VERIFIED') return 'NOT_VERIFIED';
  if (left.policyVersion !== right.policyVersion) return 'POLICY_VERSION_MISMATCH';
  return left.normalizedDocumentType === right.normalizedDocumentType &&
    left.normalizedDocumentValue === right.normalizedDocumentValue
    ? 'SAME_IDENTITY'
    : 'DIFFERENT_IDENTITY';
}
