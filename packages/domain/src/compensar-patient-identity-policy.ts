import type { PatientIdentityNormalizationPolicy } from './patient-identity';
import { assessPatientIdentity } from './patient-identity';

/**
 * COMPENSAR sends the document type in AUTO as a numeric catalogue value.
 * The document value itself remains literal: no zero trimming, case folding,
 * or separator removal is approved by this policy.
 */
const COMPENSAR_DOCUMENT_TYPE_CODES = {
  '1': 'CC',
  '3': 'TI',
  '7': 'RC',
  '4': 'CE',
  '14': 'PE',
} as const;

export type CompensarDocumentTypeCode = keyof typeof COMPENSAR_DOCUMENT_TYPE_CODES;

/** Numeric AUTO codes whose identities may be linked and looked up under this policy. */
export function compensarSourceDocumentTypeCodes(): readonly CompensarDocumentTypeCode[] {
  return Object.keys(COMPENSAR_DOCUMENT_TYPE_CODES) as CompensarDocumentTypeCode[];
}

export function isCompensarSourceDocumentType(value: string): value is CompensarDocumentTypeCode {
  return Object.prototype.hasOwnProperty.call(COMPENSAR_DOCUMENT_TYPE_CODES, value);
}

export function normalizeCompensarDocumentType(value: string): string {
  const mapped = isCompensarSourceDocumentType(value)
    ? COMPENSAR_DOCUMENT_TYPE_CODES[value]
    : undefined;
  if (mapped) return mapped;
  // MTDOM responses and manually reconciled records already use canonical codes.
  if (Object.values(COMPENSAR_DOCUMENT_TYPE_CODES).includes(value as never)) return value;
  throw new Error('UNMAPPED_COMPENSAR_DOCUMENT_TYPE');
}

/** Exact source keys accepted for a canonical lookup; unknown types never reach MTDOM. */
export function compensarDocumentTypeSourceKeys(value: string): readonly string[] {
  const canonical = normalizeCompensarDocumentType(value);
  const numeric = Object.entries(COMPENSAR_DOCUMENT_TYPE_CODES).find(
    ([, code]) => code === canonical,
  )?.[0];
  return numeric ? [numeric, canonical] : [canonical];
}

/** Excel may encode the catalogue cell as a JSON number; only that field is stringified. */
export function compensarIdentitySourceForAssessment(
  source: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const type = source.TIPO_IDENTIFICACION;
  return typeof type === 'number' && Number.isSafeInteger(type) && type >= 0
    ? { ...source, TIPO_IDENTIFICACION: String(type) }
    : source;
}

export function assessCompensarPatientIdentity(source: Readonly<Record<string, unknown>>) {
  return assessPatientIdentity(
    compensarIdentitySourceForAssessment(source),
    COMPENSAR_AUTO_PATIENT_IDENTITY_POLICY,
  );
}

export const COMPENSAR_PATIENT_IDENTITY_POLICY: PatientIdentityNormalizationPolicy = {
  version: 'COMPENSAR_DOCUMENT_TYPE_CATALOG_V1',
  normalizeDocumentType: normalizeCompensarDocumentType,
  normalizeDocumentValue: (value) => value,
};

/** AUTO evidence must use the approved numeric source code; alpha codes belong to MTDOM. */
export const COMPENSAR_AUTO_PATIENT_IDENTITY_POLICY: PatientIdentityNormalizationPolicy = {
  ...COMPENSAR_PATIENT_IDENTITY_POLICY,
  normalizeDocumentType: (value) => {
    if (!isCompensarSourceDocumentType(value))
      throw new Error('INVALID_COMPENSAR_AUTO_DOCUMENT_TYPE');
    return COMPENSAR_DOCUMENT_TYPE_CODES[value];
  },
};
