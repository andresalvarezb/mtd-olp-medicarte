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

export function deriveEnablementStatus(
  value: unknown,
): 'HABILITADO' | 'BLOQUEADO_POR_ESTADO_ORIGEN' {
  return normalizeSourceText(value) === '5' ? 'HABILITADO' : 'BLOQUEADO_POR_ESTADO_ORIGEN';
}

const MIN_PRESCRIPCION_LENGTH = 4;
const MIPRES_PRESCRIPCION_SUFFIX_LENGTH = 3;

export type DerivedPrescripcion = Readonly<{
  normalized: string;
  derived: string;
}>;

/**
 * DEC-016: el valor original de `No.PRESCRIPCION` es numérico y opcional. Vacío
 * clasifica PBS. Cuando tiene valor, la API MIPRES consume el mismo valor sin
 * sus últimos 3 dígitos de la derecha. Devuelve null cuando el valor no cumple
 * el formato técnico (solo dígitos, longitud mayor a 3).
 */
export function derivePrescripcion(value: unknown): DerivedPrescripcion | null {
  const normalized = normalizeSourceText(value);
  if (normalized === '') return { normalized: '', derived: '' };
  if (!/^\d+$/.test(normalized) || normalized.length < MIN_PRESCRIPCION_LENGTH) return null;
  return {
    normalized,
    derived: normalized.slice(0, -MIPRES_PRESCRIPCION_SUFFIX_LENGTH),
  };
}

export function deriveCoverageType(prescripcionNormalized: string): 'PBS' | 'NO_PBS' {
  return prescripcionNormalized === '' ? 'PBS' : 'NO_PBS';
}

export function deriveDirectionStatus(
  coverageType: 'PBS' | 'NO_PBS',
): 'NO_APLICA' | 'PENDIENTE' {
  return coverageType === 'PBS' ? 'NO_APLICA' : 'PENDIENTE';
}

export type OperationStatusInput = Readonly<{
  enablementStatus: 'HABILITADO' | 'BLOQUEADO_POR_ESTADO_ORIGEN';
  coverageType: 'PBS' | 'NO_PBS';
  directionStatus: 'NO_APLICA' | 'PENDIENTE' | 'CONFIRMADO' | 'ERROR_DE_CONSULTA';
  /**
   * SPEC-014: el código del medicamento (COD_COMERCIAL normalizado) está
   * incluido y activo en el Anexo Tarifario vigente.
   */
  tariffListed: boolean;
  /** Valor original de FECHA_FINAL_VIGENCIA (ej. 20261001 o 2026-10-01). */
  fechaFinalVigencia?: unknown;
  /** Fecha del sistema (America/Bogota) contra la que se evalúa la vigencia. */
  today?: string;
  /**
   * DEC-018: cuando el registro ya tuvo actividad operativa (asignación de
   * lugar, dispensación, aplicación, etc.) se preserva su estado y
   * trazabilidad aunque la vigencia haya expirado.
   */
  hasOperationalIntervention?: boolean;
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
): 'BLOQUEADO' | 'LISTO_PARA_DISPENSAR' | 'VENCIDO' {
  const ready =
    input.tariffListed === true &&
    input.enablementStatus === 'HABILITADO' &&
    ((input.coverageType === 'PBS' && input.directionStatus === 'NO_APLICA') ||
      (input.coverageType === 'NO_PBS' && input.directionStatus === 'CONFIRMADO'));
  if (!ready) return 'BLOQUEADO';
  const vigencia = parseVigenciaDate(input.fechaFinalVigencia);
  if (input.today && vigencia && input.today > vigencia) {
    // DEC-018: si ya hubo intervención operativa se preserva trazabilidad.
    if (input.hasOperationalIntervention) return 'LISTO_PARA_DISPENSAR';
    return 'VENCIDO';
  }
  return 'LISTO_PARA_DISPENSAR';
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
