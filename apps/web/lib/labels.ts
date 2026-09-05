const NUMBER_FORMAT = new Intl.NumberFormat('es-CO');

/** Formatea un número con separador de miles (ej. 1352 → 1.352). */
export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export const OPERATION_STATUS_LABELS: Record<string, string> = {
  BLOCKED: 'Bloqueada',
  READY_TO_DISPENSE: 'Lista para dispensar',
  DISPENSATION_REPORTED: 'Dispensación reportada',
  DISPENSED: 'Dispensada',
  EXPIRED: 'Vencido',
};

export const AUDIT_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'No iniciada',
  READY: 'Lista para auditar',
  IN_REVIEW: 'En revisión',
  REJECTED: 'Rechazada',
  APPROVED: 'Aprobada',
};

export const DIRECTION_STATUS_LABELS: Record<string, string> = {
  NOT_APPLICABLE: 'No aplica (PBS)',
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  QUERY_ERROR: 'Error de consulta',
};

export const COVERAGE_LABELS: Record<string, string> = {
  PBS: 'PBS',
  NO_PBS: 'NO PBS',
  UNCLASSIFIED: 'Sin clasificar',
};

export const ENABLEMENT_LABELS: Record<string, string> = {
  ENABLED: 'Habilitada',
  BLOCKED_SOURCE_STATUS: 'Bloqueada por estado fuente',
};

export const SITE_STATUS_LABELS: Record<string, string> = {
  PENDING_ASSIGNMENT: 'Pendiente',
  ASSIGNED: 'Asignado',
};

/** Estados de un lote de actualización masiva. */
export const BULK_BATCH_STATUS_LABELS: Record<string, string> = {
  UPLOADED: 'Recibido',
  QUEUED: 'En cola',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

/** Causales por fila del importador de autorizaciones. */
const IMPORT_ROW_RESULT_LABELS: Record<string, string> = {
  ROW_VALID: 'Fila válida',
  MISSING_REQUIRED_FIELD: 'Falta campo obligatorio',
  INVALID_FIELD_FORMAT: 'Formato de campo inválido',
  DUPLICATE_IN_FILE: 'Duplicada en el archivo',
  EXISTING_ITEM_REVIEW_REQUIRED: 'Existente: requiere revisión',
  EXPLICIT_UPDATE_NOT_ALLOWED: 'Actualización explícita no permitida',
  ITEM_CREATED: 'Autorización creada',
  PRODUCT_NOT_IN_TARIFF_ANNEX: 'Producto no incluido en Anexo Tarifario',
  ITEM_UPDATED: 'Autorización actualizada',
  PROCESSING_ERROR: 'Error de procesamiento',
};

/** Causales por fila y de archivo en actualizaciones masivas. */
const BULK_ROW_RESULT_LABELS: Record<string, string> = {
  ROW_UPDATED: 'Valor actualizado',
  UNCHANGED_VALUE: 'Sin cambio de valor',
  INVALID_FILE_FORMAT: 'Formato de archivo inválido',
  FILE_TOO_LARGE: 'Archivo demasiado grande',
  INVALID_HEADERS: 'Encabezados inválidos',
  MISSING_BUSINESS_KEY: 'Falta llave de negocio',
  DUPLICATE_KEY_IN_FILE: 'Llave repetida en el archivo',
  AUTHORIZATION_ITEM_NOT_FOUND: 'Autorización no encontrada',
  FORBIDDEN_ITEM_SCOPE: 'Fuera del alcance de la organización',
  OPERATION_NOT_ALLOWED: 'Operación no permitida para el estado',
  MISSING_VALUE: 'Falta el valor del campo',
  INVALID_VALUE_FORMAT: 'Formato del valor inválido',
  INVALID_OPERATION_STATE: 'Estado operativo no permite la operación',
  VERSION_CONFLICT: 'Conflicto de versión',
};

const RESULT_CODE_LABELS: Record<string, string> = {
  ...IMPORT_ROW_RESULT_LABELS,
  ...BULK_ROW_RESULT_LABELS,
};

/** Etiqueta en español para un código de resultado o error; si es desconocido, se muestra tal cual. */
export function resultLabel(code: string): string {
  return RESULT_CODE_LABELS[code] ?? code;
}

type Tone = 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple';

const AUDIT_PILL: Record<string, Tone> = {
  NOT_STARTED: 'gray',
  READY: 'orange',
  IN_REVIEW: 'purple',
  REJECTED: 'red',
  APPROVED: 'green',
};

const OPERATION_PILL: Record<string, Tone> = {
  BLOCKED: 'red',
  READY_TO_DISPENSE: 'orange',
  DISPENSATION_REPORTED: 'purple',
  DISPENSED: 'green',
  EXPIRED: 'red',
};

const DIRECTION_PILL: Record<string, Tone> = {
  NOT_APPLICABLE: 'gray',
  PENDING: 'orange',
  CONFIRMED: 'green',
  QUERY_ERROR: 'red',
};

export function auditPill(status: string): Tone {
  return AUDIT_PILL[status] ?? 'gray';
}

export function operationPill(status: string): Tone {
  return OPERATION_PILL[status] ?? 'gray';
}

export function directionPill(status: string): Tone {
  return DIRECTION_PILL[status] ?? 'gray';
}

export function coveragePill(coverage: string): Tone {
  if (coverage === 'PBS') return 'blue';
  if (coverage === 'NO_PBS') return 'purple';
  return 'gray';
}

/** sourceData contiene las columnas originales del archivo de autorizaciones. */
export function patientName(sourceData: Record<string, unknown> | null): string {
  const value = sourceData?.NOMBRE_PACIENTE;
  return typeof value === 'string' && value.trim() ? value : '—';
}

/** Identificación del paciente según el contrato canónico de autorizaciones. */
export function patientDocument(sourceData: Record<string, unknown> | null): string {
  const value = sourceData?.IDENTIFICACION_PACIENTE;
  return typeof value === 'string' && value.trim() ? value : '—';
}

/** Nombre del medicamento (CUPS_AUTORIZADO) según el archivo original. */
export function medicationName(sourceData: Record<string, unknown> | null): string {
  const value = sourceData?.CUPS_AUTORIZADO;
  return typeof value === 'string' && value.trim() ? value : '—';
}

/** Cantidad del medicamento según el archivo original. */
export function medicationQuantity(sourceData: Record<string, unknown> | null): string {
  const value = sourceData?.CANTIDAD;
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() ? value : '—';
}

export const TARIFF_IMPORT_STATUS_LABELS: Record<string, string> = {
  UPLOADED: 'Recibido',
  VALIDATING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
};

export const TARIFF_ROW_RESULT_LABELS: Record<string, string> = {
  PRODUCT_CREATED: 'Creado',
  PRODUCT_REACTIVATED: 'Reactivado',
  PRODUCT_EXISTING: 'Existente',
  INVALID_PRODUCT_CODE: 'Código inválido',
  DUPLICATE_IN_FILE: 'Duplicado en el archivo',
  INVALID_FILE_FORMAT: 'Formato inválido',
  PROCESSING_ERROR: 'Error de procesamiento',
};

export function tariffImportPill(status: string): Tone {
  if (status === 'COMPLETED') return 'green';
  if (status === 'FAILED') return 'red';
  return 'orange';
}

export function tariffRowPill(resultCode: string): Tone {
  if (resultCode === 'PRODUCT_CREATED' || resultCode === 'PRODUCT_REACTIVATED') return 'green';
  if (resultCode === 'PRODUCT_EXISTING') return 'blue';
  if (resultCode === 'DUPLICATE_IN_FILE') return 'orange';
  return 'red';
}
