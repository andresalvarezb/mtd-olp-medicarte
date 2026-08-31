import type {
  ApplicationSiteStatus,
  AuditStatus,
  BulkUpdateOperationType,
} from '@authorization/contracts';

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

export function normalizeOperationalDate(value: unknown): string {
  return normalizeOperationalText(value);
}

export function isValidOperationalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isOperationalUpdateAllowed(
  input: Readonly<{
    operationType: BulkUpdateOperationType;
    operationStatus: string | null;
    auditStatus: AuditStatus;
    lugarDispensacion: string | null;
  }>,
): boolean {
  if (input.operationStatus === null || input.operationStatus === 'BLOQUEADO') return false;
  if (input.operationType === 'ASSIGN_DISPENSATION_LOCATION') {
    return ['LISTO_PARA_DISPENSAR', 'DISPENSACION_REPORTADA', 'DISPENSADO'].includes(
      input.operationStatus,
    );
  }
  if (!input.lugarDispensacion) return false;
  if (input.operationType === 'REPORT_DISPENSATION_DATE') {
    return ['LISTO_PARA_DISPENSAR', 'DISPENSACION_REPORTADA'].includes(input.operationStatus);
  }
  return input.auditStatus !== 'APROBADO' && input.operationStatus !== 'DISPENSADO';
}

export function deriveOperationalStatuses(
  input: Readonly<{
    operationType: BulkUpdateOperationType;
    operationStatus: string;
    auditStatus: AuditStatus;
    fechaDispensacion: string | null;
    fechaAplicacion: string | null;
    newValue: string;
  }>,
): { operationStatus: string; auditStatus: AuditStatus } {
  const fechaDispensacion =
    input.operationType === 'REPORT_DISPENSATION_DATE' ? input.newValue : input.fechaDispensacion;
  const fechaAplicacion =
    input.operationType === 'REPORT_APPLICATION_DATE' ? input.newValue : input.fechaAplicacion;
  return {
    operationStatus:
      input.operationType === 'REPORT_DISPENSATION_DATE' &&
      input.operationStatus === 'LISTO_PARA_DISPENSAR'
        ? 'DISPENSACION_REPORTADA'
        : input.operationStatus,
    auditStatus:
      input.auditStatus === 'NO_INICIADO' && fechaDispensacion && fechaAplicacion
        ? 'LISTO'
        : input.auditStatus,
  };
}

/**
 * ADR-009/ADR-020/ADR-022: `application_site_status` no se persiste; se
 * deriva de la nulabilidad del lugar de dispensación.
 */
export function deriveApplicationSiteStatus(
  lugarDispensacion: string | null,
): ApplicationSiteStatus {
  return lugarDispensacion === null || lugarDispensacion === ''
    ? 'PENDIENTE_ASIGNACION'
    : 'ASIGNADO';
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
 * SPEC-011/DEC-011: la primera asignación produce ASIGNADO y un valor
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
