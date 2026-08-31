const NUMBER_FORMAT = new Intl.NumberFormat('es-CO');

/** Formatea un número con separador de miles (ej. 1352 → 1.352). */
export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

export const OPERATION_STATUS_LABELS: Record<string, string> = {
  BLOQUEADO: 'Bloqueada',
  LISTO_PARA_DISPENSAR: 'Lista para dispensar',
  DISPENSACION_REPORTADA: 'Dispensación reportada',
  DISPENSADO: 'Dispensada',
  VENCIDO: 'Vencido',
};

export const AUDIT_STATUS_LABELS: Record<string, string> = {
  NO_INICIADO: 'No iniciada',
  LISTO: 'Lista para auditar',
  EN_REVISION: 'En revisión',
  RECHAZADO: 'Rechazada',
  APROBADO: 'Visto bueno · lista para admisión',
};

export const DIRECTION_STATUS_LABELS: Record<string, string> = {
  NO_APLICA: 'No aplica (PBS)',
  PENDIENTE: 'Pendiente',
  CONFIRMADO: 'Confirmado',
  ERROR_DE_CONSULTA: 'Error de consulta',
};

export const COVERAGE_LABELS: Record<string, string> = {
  PBS: 'PBS',
  NO_PBS: 'NO PBS',
  UNCLASSIFIED: 'Sin clasificar',
};

export const ENABLEMENT_LABELS: Record<string, string> = {
  HABILITADO: 'Habilitada',
  BLOQUEADO_POR_ESTADO_ORIGEN: 'Bloqueada por estado fuente',
};

/** Resultado de la validación del Anexo Tarifario por ítem (SPEC-014). */
export const TARIFF_MEMBERSHIP_LABELS: Record<string, string> = {
  NO_EVALUADO: 'Sin evaluar',
  LISTADO: 'En Anexo Tarifario',
  NO_LISTADO: 'Fuera del Anexo Tarifario',
};

/** Causales estables de la base de novedades EPS. */
export const EPS_NOVEDAD_CAUSAL_LABELS: Record<string, string> = {
  SOURCE_STATUS_BLOCKED: 'Estado de autorización no habilita',
  AUTHORIZATION_EXPIRED: 'Autorización vencida',
  DIRECTION_PENDING: 'Direccionamiento MIPRES pendiente',
  DIRECTION_QUERY_ERROR: 'Error de consulta MIPRES',
  PRODUCT_NOT_IN_TARIFF_ANNEX: 'Producto no incluido en el Anexo Tarifario',
};

export const SITE_STATUS_LABELS: Record<string, string> = {
  PENDIENTE_ASIGNACION: 'Pendiente',
  ASIGNADO: 'Asignado',
};

/** Estados de un lote de actualización masiva. */
export const BULK_BATCH_STATUS_LABELS: Record<string, string> = {
  CARGADO: 'Recibido',
  EN_COLA: 'En cola',
  PROCESANDO: 'Procesando',
  COMPLETADO: 'Completado',
  FALLIDO: 'Fallido',
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
  ITEM_UPDATED: 'Autorización actualizada',
  PROCESSING_ERROR: 'Error de procesamiento',
};

/** Causales por fila del cargue del Anexo Tarifario (SPEC-014). */
const TARIFF_ROW_RESULT_LABELS: Record<string, string> = {
  PRODUCT_CREATED: 'Creado: agregado al Anexo Tarifario',
  PRODUCT_REACTIVATED: 'Reactivado en el Anexo Tarifario',
  PRODUCT_EXISTING: 'Existente: ya se encontraba registrado',
  INVALID_PRODUCT_CODE: 'Código obligatorio o inválido',
  DUPLICATE_IN_FILE: 'Duplicado en el archivo',
  INVALID_FILE_FORMAT: 'Estructura de archivo inválida',
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
  ...TARIFF_ROW_RESULT_LABELS,
};

/** Etiqueta en español para un código de resultado o error; si es desconocido, se muestra tal cual. */
export function resultLabel(code: string): string {
  return RESULT_CODE_LABELS[code] ?? code;
}

type Tone = 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple';

const AUDIT_PILL: Record<string, Tone> = {
  NO_INICIADO: 'gray',
  LISTO: 'orange',
  EN_REVISION: 'purple',
  RECHAZADO: 'red',
  APROBADO: 'green',
};

const OPERATION_PILL: Record<string, Tone> = {
  BLOQUEADO: 'red',
  LISTO_PARA_DISPENSAR: 'orange',
  DISPENSACION_REPORTADA: 'purple',
  DISPENSADO: 'green',
  VENCIDO: 'red',
};

const DIRECTION_PILL: Record<string, Tone> = {
  NO_APLICA: 'gray',
  PENDIENTE: 'orange',
  CONFIRMADO: 'green',
  ERROR_DE_CONSULTA: 'red',
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

/** Documento del paciente (NUM_DOCUMENTO) según el archivo original. */
export function patientDocument(sourceData: Record<string, unknown> | null): string {
  const value = sourceData?.NUM_DOCUMENTO;
  return typeof value === 'string' && value.trim() ? value : '—';
}

/** Nombre del medicamento (CUPS_AUTORIZADO) según el archivo original. */
export function medicationName(sourceData: Record<string, unknown> | null): string {
  const value = sourceData?.CUPS_AUTORIZADO;
  return typeof value === 'string' && value.trim() ? value : '—';
}
