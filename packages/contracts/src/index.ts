import { z } from 'zod';

export const correlationIdSchema = z.string().uuid();
export const idempotencyKeySchema = z.string().min(8).max(200);
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const foundationEventPayloadSchema = z.object({
  eventId: z.string().uuid(),
  message: z.string().min(1).max(200),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const foundationJobSchema = z.object({
  name: z.literal('foundation.event'),
  version: z.literal(1),
  payload: foundationEventPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  organizations: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      name: z.string(),
      roles: z.array(z.string()),
      permissions: z.array(z.string()),
    }),
  ),
});

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
  correlationId: z.string(),
});

export type FoundationJob = z.infer<typeof foundationJobSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export const FOUNDATION_QUEUE = 'foundation';
export const FOUNDATION_DEAD_LETTER_QUEUE = 'foundation.dead-letter';
export const FOUNDATION_JOB_NAME = 'foundation.event.v1';
export const FOUNDATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 500 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};

export const IMPORT_QUEUE = 'authorization-imports';
export const IMPORT_DEAD_LETTER_QUEUE = 'authorization-imports.dead-letter';
export const IMPORT_JOB_NAME = 'authorization.import.v1';
export const IMPORT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};

export const importBatchStatusSchema = z.enum([
  'UPLOADED',
  'VALIDATING',
  'READY_TO_CONFIRM',
  'CONFIRMING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type ImportBatchStatus = z.infer<typeof importBatchStatusSchema>;

export const importRowResultCodeSchema = z.enum([
  'ROW_VALID',
  'MISSING_REQUIRED_FIELD',
  'INVALID_FIELD_FORMAT',
  'DUPLICATE_IN_FILE',
  'EXISTING_ITEM_REVIEW_REQUIRED',
  'EXPLICIT_UPDATE_NOT_ALLOWED',
  'ITEM_CREATED',
  'ITEM_UPDATED',
  'PROCESSING_ERROR',
]);
export type ImportRowResultCode = z.infer<typeof importRowResultCodeSchema>;

export const importRowResultMessages: Record<ImportRowResultCode, string> = {
  ROW_VALID: 'Fila válida para confirmar.',
  MISSING_REQUIRED_FIELD: 'Falta un campo obligatorio.',
  INVALID_FIELD_FORMAT: 'El archivo o el valor no cumple el formato técnico.',
  DUPLICATE_IN_FILE: 'La llave aparece repetida dentro del archivo.',
  EXISTING_ITEM_REVIEW_REQUIRED: 'La llave ya existe y requiere verificación humana.',
  EXPLICIT_UPDATE_NOT_ALLOWED:
    'La actualización explícita no está permitida para el estado actual.',
  ITEM_CREATED: 'Ítem creado durante la confirmación.',
  ITEM_UPDATED: 'Actualización explícita completada.',
  PROCESSING_ERROR: 'No fue posible procesar la fila.',
};

export const enablementStatusSchema = z.enum(['ENABLED', 'BLOCKED_SOURCE_STATUS']);
export const coverageTypeSchema = z.enum(['UNCLASSIFIED', 'PBS', 'NO_PBS']);
export const directionStatusSchema = z.enum([
  'NOT_APPLICABLE',
  'PENDING',
  'CONFIRMED',
  'QUERY_ERROR',
]);
export const operationStatusSchema = z.enum([
  'BLOCKED',
  'READY_TO_DISPENSE',
  'DISPENSATION_REPORTED',
  'DISPENSED',
]);

export const authorizationSourceColumns = [
  'CODEPS',
  'NUMERO_AUTORIZACION',
  'TIP_DOCUMENTO',
  'NUM_DOCUMENTO',
  'NOMBRE_PACIENTE',
  'NUMERO_TELEFONO',
  'COD_CUPS_PRINCIPAL',
  'CUPS_PRINCIPAL',
  'COD_COMERCIAL',
  'CUMS',
  'NIT_PRESTADOR',
  'NOMBRE_PRESTADOR',
  'COD_CUPS_AUTORIZADO',
  'CUPS_AUTORIZADO',
  'CANTIDAD',
  'DOSIS',
  'FECHA_ASIGNACION',
  'FECHA_FINAL_VIGENCIA',
  'ESTADO_AUTORIZACION',
  'No.PRESCRIPCION',
  'OBS_AUTORIZACION',
  'MEDICO_REMITENTE',
  'CMNT',
  '_Id',
  'FPRO',
  'VALOR CUOTA MODERADORA',
] as const;
export type AuthorizationSourceColumn = (typeof authorizationSourceColumns)[number];
export const requiredAuthorizationSourceColumns = [
  'NUMERO_AUTORIZACION',
  'COD_COMERCIAL',
  'ESTADO_AUTORIZACION',
  'No.PRESCRIPCION',
] as const;

export const authorizationClassificationSchema = z.object({
  numeroAutorizacion: z.string().min(1),
  codigoMedicamento: z.string().min(1),
  authorizationKey: z.string().min(3),
  sourceStatusNormalized: z.string(),
  prescripcionNormalized: z.string(),
  noPrescripcion: z.string(),
  enablementStatus: enablementStatusSchema,
  coverageType: coverageTypeSchema.exclude(['UNCLASSIFIED']),
  directionStatus: directionStatusSchema,
  operationStatus: operationStatusSchema.nullable(),
});
export type AuthorizationClassification = z.infer<typeof authorizationClassificationSchema>;

export const authorizationImportPayloadSchema = z.object({
  eventId: z.string().uuid(),
  batchId: z.string().uuid(),
  sourceFileId: z.string().uuid(),
  processorVersion: z.number().int().positive(),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const authorizationImportJobSchema = z.object({
  name: z.literal('authorization.import'),
  version: z.literal(1),
  payload: authorizationImportPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AuthorizationImportJob = z.infer<typeof authorizationImportJobSchema>;

export const importBatchResponseSchema = z.object({
  id: z.string().uuid(),
  status: importBatchStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  existingRows: z.number().int().nonnegative(),
  confirmedRows: z.number().int().nonnegative(),
  lastErrorCode: z.string().min(1).max(80).nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});
export type ImportBatchResponse = z.infer<typeof importBatchResponseSchema>;

export const confirmImportResponseSchema = z.object({
  batchId: z.string().uuid(),
  status: z.literal('COMPLETED'),
  createdRows: z.number().int().nonnegative(),
  existingRows: z.number().int().nonnegative(),
  confirmedAt: isoDateTimeSchema,
});
export type ConfirmImportResponse = z.infer<typeof confirmImportResponseSchema>;

export const importRowResponseSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  resultCode: importRowResultCodeSchema,
  resultMessage: z.string(),
  confirmable: z.boolean(),
  authorizationItemId: z.string().uuid().nullable(),
  authorizationKey: z.string().nullable(),
  normalized: authorizationClassificationSchema.nullable(),
  validationErrors: z.array(z.object({ field: z.string(), code: z.string(), message: z.string() })),
});
export type ImportRowResponse = z.infer<typeof importRowResponseSchema>;

export const paginatedImportRowsResponseSchema = z.object({
  items: z.array(importRowResponseSchema),
  nextCursor: z.string().nullable(),
});

export const authorizationItemListQuerySchema = z.object({
  coverageType: coverageTypeSchema.exclude(['UNCLASSIFIED']).optional(),
  enablementStatus: enablementStatusSchema.optional(),
  directionStatus: directionStatusSchema.optional(),
  operationStatus: operationStatusSchema.optional(),
  authorizationKey: z.string().trim().min(1).max(300).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuthorizationItemListQuery = z.infer<typeof authorizationItemListQuerySchema>;

export const authorizationItemResponseSchema = z.object({
  id: z.string().uuid(),
  numeroAutorizacion: z.string(),
  codigoMedicamento: z.string(),
  authorizationKey: z.string(),
  enablementStatus: enablementStatusSchema,
  coverageType: coverageTypeSchema,
  directionStatus: directionStatusSchema,
  operationStatus: operationStatusSchema.nullable(),
  sourceData: z.record(z.string(), z.unknown()).nullable(),
  sourcePrescripcionNormalized: z.string(),
  noPrescripcion: z.string(),
  coverageRuleVersion: z.string(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AuthorizationItemResponse = z.infer<typeof authorizationItemResponseSchema>;

export const authorizationItemHistorySchema = z.object({
  batchId: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  resultCode: importRowResultCodeSchema,
  createdAt: isoDateTimeSchema,
});

export const authorizationItemDetailResponseSchema = z.object({
  item: authorizationItemResponseSchema,
  importHistory: z.array(authorizationItemHistorySchema),
});
export type AuthorizationItemDetailResponse = z.infer<typeof authorizationItemDetailResponseSchema>;

export const paginatedAuthorizationItemsResponseSchema = z.object({
  items: z.array(authorizationItemResponseSchema),
  nextCursor: z.string().nullable(),
});

export const sourceUpdateRequestSchema = z.object({
  importRowId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});

export const sourceUpdateResponseSchema = z.object({
  item: authorizationItemResponseSchema,
  rowId: z.string().uuid(),
  resultCode: z.literal('ITEM_UPDATED'),
});
