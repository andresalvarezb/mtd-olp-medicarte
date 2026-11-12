/**
 * Approved document-type aliases shared by Alto Costo authorization files and MTDOM.
 * Unknown types remain exact and are never inferred from the document number.
 */
export const PATIENT_DOCUMENT_TYPE_CODE_ALIASES = [
  { rawType: '1', canonicalType: 'CC' },
] as const;

export function canonicalPatientDocumentType(rawType: string): string {
  return PATIENT_DOCUMENT_TYPE_CODE_ALIASES.find((alias) => alias.rawType === rawType)
    ?.canonicalType ?? rawType;
}

export function patientDocumentTypeAliases(rawType: string): readonly string[] {
  const canonicalType = canonicalPatientDocumentType(rawType);
  const alias = PATIENT_DOCUMENT_TYPE_CODE_ALIASES.find(
    (item) => item.canonicalType === canonicalType,
  );
  return alias ? [canonicalType, alias.rawType] : [canonicalType];
}
