import type { ApplicationSiteStatus } from '@authorization/contracts';

/**
 * Fase 4 (SPEC-011/ADR-020): `lugar_dispensacion` es texto libre decidido por
 * el negocio. El sistema solo exige valor no vacío y normaliza espacios; no
 * valida estructura de dirección ni aplica mayúsculas (el contenido es del
 * negocio).
 */
export function normalizeOperationalText(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? `${value}`
        : (JSON.stringify(value) ?? '');
  return text.trim().replace(/\s+/g, ' ');
}

const MAX_OPERATIONAL_TEXT_LENGTH = 500;

export function isValidOperationalText(value: string): boolean {
  return value.trim().length > 0 && value.length <= MAX_OPERATIONAL_TEXT_LENGTH;
}

/**
 * ADR-009/ADR-020/ADR-022: `application_site_status` no se persiste; se
 * deriva de la nulabilidad del lugar de dispensación.
 */
export function deriveApplicationSiteStatus(lugarDispensacion: string | null): ApplicationSiteStatus {
  return lugarDispensacion === null || lugarDispensacion === ''
    ? 'PENDING_ASSIGNMENT'
    : 'ASSIGNED';
}

export const OPERATIONAL_FIELD_LUGAR_DISPENSACION = 'lugar_dispensacion' as const;

export type OperationalFieldTransition = Readonly<{
  field: typeof OPERATIONAL_FIELD_LUGAR_DISPENSACION;
  previousValue: string | null;
  newValue: string;
  previousVersion: number;
  newVersion: number;
  eventType: 'DISPENSATION_LOCATION_ASSIGNED' | 'DISPENSATION_LOCATION_CHANGED' | null;
}>;

/**
 * SPEC-011/DEC-011: la primera asignación produce ASSIGNED y un valor
 * idéntico no emite evento ni versión nueva.
 */
export function evaluateOperationalFieldTransition(
  previousValue: string | null,
  newValue: string,
  currentVersion: number,
): OperationalFieldTransition {
  const eventType =
    previousValue === null
      ? 'DISPENSATION_LOCATION_ASSIGNED'
      : previousValue === newValue
        ? null
        : 'DISPENSATION_LOCATION_CHANGED';
  return {
    field: OPERATIONAL_FIELD_LUGAR_DISPENSACION,
    previousValue,
    newValue,
    previousVersion: currentVersion,
    newVersion: eventType ? currentVersion + 1 : currentVersion,
    eventType,
  };
}
