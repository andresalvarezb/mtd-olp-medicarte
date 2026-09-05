import type { AuthorizationClassification } from '@authorization/contracts';

export type AuthorizationClassificationInput = Readonly<{
  numeroAutorizacion: unknown;
  codigoComercial: unknown;
  noPrescripcion: unknown;
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

export function parseAuthorizationKeyInput(
  value: unknown,
): {
  numeroAutorizacion: string;
  codigoMedicamento: string;
  authorizationKey: string;
} | null {
  const text =
    typeof value === 'string' || typeof value === 'number' ? `${value}`.trim() : '';
  if (!text) return null;
  const components: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of text) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      current += character;
      escaped = true;
    } else if (character === ':') {
      components.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  components.push(current);
  if (components.length !== 2) return null;
  const [numeroAutorizacion, codigoMedicamento] = components.map((component) =>
    component.replace(/\\([\\:])/g, '$1'),
  );
  return buildAuthorizationKey(numeroAutorizacion, codigoMedicamento);
}

export function deriveEnablementStatus(value: unknown): 'ENABLED' | 'BLOCKED_SOURCE_STATUS' {
  return normalizeSourceText(value) === '5' ? 'ENABLED' : 'BLOCKED_SOURCE_STATUS';
}

const MIPRES_PRESCRIPCION_SUFFIX_LENGTH = 3;

export type DerivedPrescripcion = Readonly<{
  normalized: string;
  derived: string;
}>;

/**
 * DEC-016: el valor original de `No.PRESCRIPCION` es numérico y opcional. Vacío
 * clasifica PBS. Cuando tiene valor, la API MIPRES consume el mismo valor sin
 * sus últimos 3 dígitos de la derecha. Devuelve null cuando el valor no cumple
 * el formato funcional (exactamente 20 dígitos).
 */
export function derivePrescripcion(value: unknown): DerivedPrescripcion | null {
  const normalized = normalizeSourceText(value);
  if (normalized === '') return { normalized: '', derived: '' };
  if (!/^\d{20}$/.test(normalized)) return null;
  return {
    normalized,
    derived: normalized.slice(0, -MIPRES_PRESCRIPCION_SUFFIX_LENGTH),
  };
}

export function deriveCoverageType(prescripcionNormalized: string): 'PBS' | 'NO_PBS' {
  return prescripcionNormalized === '' ? 'PBS' : 'NO_PBS';
}

/** La cobertura de la autorización debe coincidir con el Anexo Tarifario. */
export function isTariffCoverageConsistent(
  coverageType: 'PBS' | 'NO_PBS',
  tipoInclusion: unknown,
): boolean {
  const normalized = normalizeSourceText(tipoInclusion).replace(/\s+/g, '');
  return (coverageType === 'PBS' && normalized === 'PBS') ||
    (coverageType === 'NO_PBS' && normalized === 'NOPBS');
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
  /**
   * SPEC-014 / ADR-024: inclusión del producto (codigo_medicamento) en el
   * Anexo Tarifario vigente. Sin producto listado no hay disponibilidad.
   */
  productInTariffAnnex: boolean;
  /** Valor original de FECHA_FINAL_VIGENCIA (ej. 20261001 o 2026-10-01). */
  fechaFinalVigencia?: unknown;
  /** Fecha del sistema (America/Bogota) contra la que se evalúa la vigencia. */
  today?: string;
}>;

/**
 * Normaliza FECHA_FINAL_VIGENCIA a YYYY-MM-DD. Acepta 20261001 y 2026-10-01;
 * devuelve null cuando el valor no representa una fecha válida.
 */
export function parseVigenciaDate(value: unknown): string | null {
  const digits = normalizeSourceText(value).replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function deriveOperationStatus(
  input: OperationStatusInput,
): 'BLOCKED' | 'READY_TO_DISPENSE' | 'EXPIRED' {
  const ready =
    input.enablementStatus === 'ENABLED' &&
    input.productInTariffAnnex &&
    ((input.coverageType === 'PBS' && input.directionStatus === 'NOT_APPLICABLE') ||
      (input.coverageType === 'NO_PBS' && input.directionStatus === 'CONFIRMED'));
  if (!ready) return 'BLOCKED';
  // La autorización venció si la fecha del sistema supera FECHA_FINAL_VIGENCIA.
  // Sin valor de vigencia verificable no se aplica la regla.
  const vigencia = parseVigenciaDate(input.fechaFinalVigencia);
  if (input.today && vigencia && input.today > vigencia) return 'EXPIRED';
  return 'READY_TO_DISPENSE';
}

export function deriveAuthorizationClassification(
  input: AuthorizationClassificationInput,
): AuthorizationClassification | null {
  const key = buildAuthorizationKey(input.numeroAutorizacion, input.codigoComercial);
  const sourceStatusNormalized = normalizeSourceText(input.estadoAutorizacion);
  if (!key || !sourceStatusNormalized) return null;
  const prescripcion = derivePrescripcion(input.noPrescripcion);
  if (!prescripcion) return null;
  const coverageType = deriveCoverageType(prescripcion.normalized);
  return {
    ...key,
    sourceStatusNormalized,
    prescripcionNormalized: prescripcion.normalized,
    noPrescripcion: prescripcion.derived,
    enablementStatus: deriveEnablementStatus(sourceStatusNormalized),
    coverageType,
    directionStatus: deriveDirectionStatus(coverageType),
    operationStatus: null,
  };
}

export type EarlyProcessStatus =
  | 'NOVEDAD'
  | 'PENDIENTE_VALIDACION_MIPRES'
  | 'LISTO_PARA_DISPENSAR';

/**
 * ADR-027/SPEC-014: etapa funcional temprana de un ítem recién creado o
 * reprocesado, antes de cualquier avance operativo. Refleja el CASE de la
 * migración 0023 y nunca debe retroceder ítems ya avanzados.
 */
export function deriveEarlyProcessStatus(input: Readonly<{
  operationStatus: 'BLOCKED' | 'READY_TO_DISPENSE' | 'DISPENSATION_REPORTED' | 'DISPENSED' | 'EXPIRED' | null;
  coverageType: 'PBS' | 'NO_PBS';
  directionStatus: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
}>): EarlyProcessStatus {
  if (input.operationStatus === 'READY_TO_DISPENSE') return 'LISTO_PARA_DISPENSAR';
  if (input.coverageType === 'NO_PBS' && input.directionStatus === 'PENDING') {
    return 'PENDIENTE_VALIDACION_MIPRES';
  }
  return 'NOVEDAD';
}
