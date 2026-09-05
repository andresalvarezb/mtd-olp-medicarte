import type {
  BulkUpdateRowResultCode,
  ImportRowResultCode,
  NoveltyErrorType,
  TariffImportRowResultCode,
} from '@authorization/contracts';
import { NOVELTY_ERROR_TYPE_VALUES } from '@authorization/contracts';

export type { NoveltyErrorType };

export const NOVELTY_ERROR_TYPES = NOVELTY_ERROR_TYPE_VALUES;

export const NOVELTY_UNKNOWN_ERROR_TYPE: NoveltyErrorType = 'REQUIERE_VALIDACION';

export function noveltyErrorTypeFor(errorType: string | null | undefined): NoveltyErrorType {
  return NOVELTY_ERROR_TYPES.includes(errorType as NoveltyErrorType)
    ? (errorType as NoveltyErrorType)
    : NOVELTY_UNKNOWN_ERROR_TYPE;
}

export type NoveltyProjection = Readonly<{
  code: string;
  stage: string;
  field: string | null;
  message: string;
}>;

const INVALID_FIELD_FORMAT_PROJECTION: NoveltyProjection = { code: 'CSV_005', stage: 'CSV', field: null, message: 'El valor no cumple el formato esperado.' };

const IMPORT_NOVELTY_BY_RESULT: Record<Exclude<ImportRowResultCode, 'ROW_VALID' | 'ITEM_CREATED' | 'ITEM_UPDATED'>, NoveltyProjection | null> = {
  MISSING_REQUIRED_FIELD: { code: 'CSV_004', stage: 'CSV', field: null, message: 'Falta un valor obligatorio.' },
  INVALID_FIELD_FORMAT: INVALID_FIELD_FORMAT_PROJECTION,
  DUPLICATE_IN_FILE: { code: 'CSV_002', stage: 'CSV', field: 'LLAVE', message: 'La LLAVE aparece más de una vez dentro del archivo.' },
  EXISTING_ITEM_REVIEW_REQUIRED: null,
  EXPLICIT_UPDATE_NOT_ALLOWED: { code: 'AUTH_003', stage: 'AUTORIZACIONES', field: null, message: 'La autorización está bloqueada por avance operacional.' },
  PRODUCT_NOT_IN_TARIFF_ANNEX: { code: 'ANX_001', stage: 'ANEXO_TARIFARIO', field: 'CODIGO_PRODUCTO', message: 'El producto no existe en el Anexo Tarifario.' },
  PROCESSING_ERROR: { code: 'TECH_001', stage: 'OPERACION', field: null, message: 'Error técnico durante el procesamiento; el registro puede reprocesarse sin recargar el archivo.' },
};

export function noveltyForImportResult(
  resultCode: ImportRowResultCode,
  missingHeaders: readonly string[] = [],
  invalidField?: string | null,
): NoveltyProjection | null {
  if (resultCode === 'MISSING_REQUIRED_FIELD' && missingHeaders.length > 0) {
    return { code: 'CSV_003', stage: 'CSV', field: missingHeaders[0] ?? null, message: 'Falta una columna obligatoria del contrato CSV.' };
  }
  if (resultCode === 'INVALID_FIELD_FORMAT') {
    const field = invalidField ?? null;
    if (field && /PRESCRIPCION/i.test(field)) {
      return { code: 'CLS_001', stage: 'CLASIFICACION', field, message: 'La prescripción debe estar vacía o contener exactamente 20 dígitos.' };
    }
    return {
      code: INVALID_FIELD_FORMAT_PROJECTION.code,
      stage: INVALID_FIELD_FORMAT_PROJECTION.stage,
      field,
      message: INVALID_FIELD_FORMAT_PROJECTION.message,
    };
  }
  if (resultCode === 'ROW_VALID' || resultCode === 'ITEM_CREATED' || resultCode === 'ITEM_UPDATED') return null;
  return IMPORT_NOVELTY_BY_RESULT[resultCode];
}

export function noveltyForTariffImportResult(resultCode: TariffImportRowResultCode): NoveltyProjection | null {
  switch (resultCode) {
    case 'DUPLICATE_IN_FILE':
      return { code: 'CSV_002', stage: 'CSV', field: 'CODIGO_PRODUCTO', message: 'El CODIGO_PRODUCTO aparece más de una vez dentro del archivo.' };
    case 'INVALID_PRODUCT_CODE':
      return { code: 'CSV_005', stage: 'ANEXO_TARIFARIO', field: 'CODIGO_PRODUCTO', message: 'El código de producto es obligatorio o tiene formato inválido.' };
    case 'PROCESSING_ERROR':
      return { code: 'TECH_001', stage: 'OPERACION', field: null, message: 'Error técnico durante el procesamiento; el registro puede reprocesarse sin recargar el archivo.' };
    default:
      return null;
  }
}

export function noveltyForBulkResult(code: BulkUpdateRowResultCode): NoveltyProjection | null {
  switch (code) {
    case 'DUPLICATE_KEY_IN_FILE':
      return { code: 'CSV_002', stage: 'CSV', field: 'LLAVE', message: 'La LLAVE aparece más de una vez dentro del archivo.' };
    case 'MISSING_BUSINESS_KEY':
    case 'MISSING_VALUE':
      return { code: 'CSV_004', stage: 'CSV', field: null, message: 'Falta un valor obligatorio.' };
    case 'INVALID_FILE_FORMAT':
    case 'INVALID_HEADERS':
    case 'INVALID_VALUE_FORMAT':
      return { code: 'CSV_005', stage: 'CSV', field: null, message: 'El valor no cumple el formato esperado.' };
    case 'AUTHORIZATION_ITEM_NOT_FOUND':
      return { code: 'LOCK_001', stage: 'OPERACION', field: 'LLAVE', message: 'La etapa está bloqueada por avance del proceso.' };
    case 'FORBIDDEN_ITEM_SCOPE':
    case 'OPERATION_NOT_ALLOWED':
    case 'INVALID_OPERATION_STATE':
      return { code: 'LOCK_001', stage: 'OPERACION', field: null, message: 'La etapa está bloqueada por avance del proceso.' };
    case 'VERSION_CONFLICT':
      return { code: 'CONC_001', stage: 'OPERACION', field: null, message: 'El registro fue modificado por otro proceso; no se sobrescribió el cambio.' };
    case 'PROCESSING_ERROR':
      return { code: 'TECH_001', stage: 'OPERACION', field: null, message: 'Error técnico durante el procesamiento; el registro puede reprocesarse sin recargar el archivo.' };
    default:
      return null;
  }
}

export const EPS_CAUSAL_TO_NOVELTY: Record<string, string> = {
  SOURCE_STATUS_BLOCKED: 'SRC_001',
  AUTHORIZATION_EXPIRED: 'AUTH_002',
  DIRECTION_PENDING: 'MIP_001',
  DIRECTION_QUERY_ERROR: 'MIP_001',
  PRODUCT_NOT_IN_TARIFF_ANNEX: 'ANX_001',
};
