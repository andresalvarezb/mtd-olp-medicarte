import type { AuthorizationClassification } from '@authorization/contracts';

export type AuthorizationClassificationInput = Readonly<{
  numeroAutorizacion: unknown;
  codigoComercial: unknown;
  cupsPrincipal: unknown;
  estadoAutorizacion: unknown;
}>;

export function normalizeSourceText(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? `${value}`
        : (JSON.stringify(value) ?? '');
  return text.trim().toUpperCase().replace(/\s+/g, ' ');
}

const MAX_IDENTITY_COMPONENT_LENGTH = 250;
const MAX_AUTHORIZATION_KEY_LENGTH = 511;

function escapeKeyComponent(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

export function buildAuthorizationKey(
  numeroAutorizacion: unknown,
  codigoComercial: unknown,
): {
  numeroAutorizacion: string;
  codigoMedicamento: string;
  authorizationKey: string;
} | null {
  const normalizedAuthorization = normalizeSourceText(numeroAutorizacion);
  const normalizedMedication = normalizeSourceText(codigoComercial);
  if (!normalizedAuthorization || !normalizedMedication) return null;
  if (
    normalizedAuthorization.length > MAX_IDENTITY_COMPONENT_LENGTH ||
    normalizedMedication.length > MAX_IDENTITY_COMPONENT_LENGTH
  )
    return null;
  const authorizationKey = `${escapeKeyComponent(normalizedAuthorization)}:${escapeKeyComponent(normalizedMedication)}`;
  if (authorizationKey.length > MAX_AUTHORIZATION_KEY_LENGTH) return null;
  return {
    numeroAutorizacion: normalizedAuthorization,
    codigoMedicamento: normalizedMedication,
    authorizationKey,
  };
}

export function deriveEnablementStatus(value: unknown): 'ENABLED' | 'BLOCKED_SOURCE_STATUS' {
  return normalizeSourceText(value) === '5' ? 'ENABLED' : 'BLOCKED_SOURCE_STATUS';
}

export function deriveCoverageType(value: unknown): 'PBS' | 'NO_PBS' {
  return normalizeSourceText(value) === 'MEDICAMENTOS NO POS' ? 'NO_PBS' : 'PBS';
}

export function deriveDirectionStatus(
  coverageType: 'PBS' | 'NO_PBS',
): 'NOT_APPLICABLE' | 'PENDING' {
  return coverageType === 'PBS' ? 'NOT_APPLICABLE' : 'PENDING';
}

export type OperationStatusInput = Readonly<{
  enablementStatus: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  coverageType: 'PBS' | 'NO_PBS';
  directionStatus: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
}>;

export function deriveOperationStatus(
  input: OperationStatusInput,
): 'BLOCKED' | 'READY_TO_DISPENSE' {
  const ready =
    input.enablementStatus === 'ENABLED' &&
    ((input.coverageType === 'PBS' && input.directionStatus === 'NOT_APPLICABLE') ||
      (input.coverageType === 'NO_PBS' && input.directionStatus === 'CONFIRMED'));
  return ready ? 'READY_TO_DISPENSE' : 'BLOCKED';
}

export function deriveAuthorizationClassification(
  input: AuthorizationClassificationInput,
): AuthorizationClassification | null {
  const key = buildAuthorizationKey(input.numeroAutorizacion, input.codigoComercial);
  const cupsPrincipalNormalized = normalizeSourceText(input.cupsPrincipal);
  const sourceStatusNormalized = normalizeSourceText(input.estadoAutorizacion);
  if (!key || !cupsPrincipalNormalized || !sourceStatusNormalized) return null;
  const coverageType = deriveCoverageType(cupsPrincipalNormalized);
  return {
    ...key,
    cupsPrincipalNormalized,
    sourceStatusNormalized,
    enablementStatus: deriveEnablementStatus(sourceStatusNormalized),
    coverageType,
    directionStatus: deriveDirectionStatus(coverageType),
    operationStatus: null,
  };
}
