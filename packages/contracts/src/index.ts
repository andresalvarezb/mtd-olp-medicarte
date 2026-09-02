import { z } from 'zod';
import { tariffAnnexSourceColumns } from './headers';
import type { authorizationSourceColumns } from './headers';
export {
  HEADERS,
  authorizationSourceColumns,
  canonicalizeHeader,
  sanitizeHeader,
  tariffAnnexSourceColumns,
} from './headers';
export type { CanonicalHeader } from './headers';

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

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 160;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Identificador de acceso: se normaliza (trim + minúsculas) ANTES de validar
 * el formato, para que el login sea realmente case-insensitive.
 */
export const usernameSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .regex(/^[a-z0-9][a-z0-9._@-]{1,158}$/, 'invalid username format'),
);
export type Username = z.infer<typeof usernameSchema>;

/** Política mínima: prioridad a la longitud (ADR-026). */
export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const loginRequestSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresAt: isoDateTimeSchema,
  mustChangePassword: z.boolean(),
  user: z.object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
  }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  mustChangePassword: z.boolean(),
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

export const MIPRES_QUEUE = 'mipres';
export const MIPRES_DEAD_LETTER_QUEUE = 'mipres.dead-letter';
export const MIPRES_JOB_NAME = 'authorization.mipres.v1';
export const MIPRES_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};

export const mipresQueryTypeSchema = z.enum(['AUTO', 'MANUAL']);
export type MipresQueryType = z.infer<typeof mipresQueryTypeSchema>;

export const mipresRecheckPayloadSchema = z.object({
  eventId: z.string().uuid(),
  itemId: z.string().uuid(),
  prescriptionNumber: z.string().min(1).max(255),
  queryType: mipresQueryTypeSchema,
  requestedBy: z.string().uuid().nullable(),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type MipresRecheckPayload = z.infer<typeof mipresRecheckPayloadSchema>;

export const mipresRecheckJobSchema = z.object({
  name: z.literal('authorization.mipres-recheck'),
  version: z.literal(1),
  payload: mipresRecheckPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type MipresRecheckJob = z.infer<typeof mipresRecheckJobSchema>;

export const mipresRecheckRequestResponseSchema = z.object({
  itemId: z.string().uuid(),
  status: z.literal('QUEUED'),
  queryType: mipresQueryTypeSchema,
  correlationId: correlationIdSchema,
});
export type MipresRecheckRequestResponse = z.infer<typeof mipresRecheckRequestResponseSchema>;

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
  'PRODUCT_NOT_IN_TARIFF_ANNEX',
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
  PRODUCT_NOT_IN_TARIFF_ANNEX: 'Producto no incluido en el Anexo Tarifario.',
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
  'EXPIRED',
]);
export const auditStatusSchema = z.enum([
  'NOT_STARTED',
  'READY',
  'IN_REVIEW',
  'REJECTED',
  'APPROVED',
]);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

/** SPEC-002/ADR-009: admisión derivada por reglas de dominio; nunca editable por UI.
 * READY habilita la descarga de la base para el proceso externo de admisiones;
 * no existen estados de handoff en el núcleo (el alcance de Fase 6 cierra la plataforma). */
export const admissionStatusSchema = z.enum(['NOT_READY', 'READY']);
export type AdmissionStatus = z.infer<typeof admissionStatusSchema>;
export const operationalDateSchema = z.string().date();

/** Fase 4 (SPEC-011/ADR-020): estado de sitio derivado, nunca persistido. */
export const applicationSiteStatusSchema = z.enum(['PENDING_ASSIGNMENT', 'ASSIGNED']);
export type ApplicationSiteStatus = z.infer<typeof applicationSiteStatusSchema>;

export type AuthorizationSourceColumn = (typeof authorizationSourceColumns)[number];
export const requiredAuthorizationSourceColumns = [
  'NUMERO_AUTORIZACION',
  'CODIGO_COMERCIAL',
  'ESTADO_AUTORIZACION',
  'NUMERO_PRESCRIPCION',
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
  tariffRejectedRows: z.number().int().nonnegative().default(0),
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
  applicationSiteStatus: applicationSiteStatusSchema.optional(),
  auditStatus: auditStatusSchema.optional(),
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
  lugarDispensacion: z.string().nullable(),
  fechaDispensacion: operationalDateSchema.nullable(),
  fechaAplicacion: operationalDateSchema.nullable(),
  auditStatus: auditStatusSchema,
  admissionStatus: admissionStatusSchema,
  applicationSiteStatus: applicationSiteStatusSchema,
  operationalVersion: z.number().int().nonnegative(),
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

// ---------------------------------------------------------------------------
// Fase 6 — Auditoría humana, hallazgos y decisiones (SPEC-006, SPEC-002, ADR-009).
// ---------------------------------------------------------------------------

export const auditReviewStatusSchema = z.enum(['IN_REVIEW', 'APPROVED', 'REJECTED']);
export type AuditReviewStatus = z.infer<typeof auditReviewStatusSchema>;

export const auditReviewResponseSchema = z.object({
  id: z.string().uuid(),
  authorizationItemId: z.string().uuid(),
  reviewNumber: z.number().int().positive(),
  status: auditReviewStatusSchema,
  observations: z.string().nullable(),
  decidedBy: z.string().uuid().nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  startedBy: z.string().uuid(),
  startedAt: isoDateTimeSchema,
  findings: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string().min(1).max(80),
      description: z.string().min(1).max(2000),
      createdAt: isoDateTimeSchema,
    }),
  ),
});
export type AuditReviewResponse = z.infer<typeof auditReviewResponseSchema>;

export const startAuditReviewRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type StartAuditReviewRequest = z.infer<typeof startAuditReviewRequestSchema>;

export const startAuditReviewResponseSchema = z.object({
  review: auditReviewResponseSchema,
  item: authorizationItemResponseSchema,
});
export type StartAuditReviewResponse = z.infer<typeof startAuditReviewResponseSchema>;

export const auditFindingRequestSchema = z.object({
  code: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(2000),
});
export type AuditFindingRequest = z.infer<typeof auditFindingRequestSchema>;

export const auditFindingResponseSchema = z.object({
  id: z.string().uuid(),
  auditReviewId: z.string().uuid(),
  code: z.string().min(1).max(80),
  description: z.string().min(1).max(2000),
  createdAt: isoDateTimeSchema,
});
export type AuditFindingResponse = z.infer<typeof auditFindingResponseSchema>;

export const rejectAuditReviewRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  observations: z.string().trim().min(1).max(2000),
});
export type RejectAuditReviewRequest = z.infer<typeof rejectAuditReviewRequestSchema>;

export const approveAuditReviewRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  observations: z.string().trim().max(2000).optional(),
});
export type ApproveAuditReviewRequest = z.infer<typeof approveAuditReviewRequestSchema>;

export const auditDecisionResponseSchema = z.object({
  review: auditReviewResponseSchema,
  item: authorizationItemResponseSchema,
});
export type AuditDecisionResponse = z.infer<typeof auditDecisionResponseSchema>;

export const authorizationItemDetailResponseSchema = z.object({
  item: authorizationItemResponseSchema,
  importHistory: z.array(authorizationItemHistorySchema),
  auditReviews: z.array(auditReviewResponseSchema),
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

// ---------------------------------------------------------------------------
// Fase 4 — Disponibilidad, bulk updates operativos y notificaciones.
// Contratos compartidos web/api/worker (GLOBAL_RULES: no duplicar DTO/enums).
// ---------------------------------------------------------------------------

export const bulkUpdateOperationTypeSchema = z.enum([
  'ASSIGN_DISPENSATION_LOCATION',
  'REPORT_DISPENSATION_DATE',
  'REPORT_APPLICATION_DATE',
]);
export type BulkUpdateOperationType = z.infer<typeof bulkUpdateOperationTypeSchema>;

/** Catálogo cerrado ADR-022. Cada tipo fija actor, permiso y columna mutable.
 * Los tipos de lugar y fecha de dispensación usan `authorization_key` como única
 * llave de negocio (pareja normalizada numero_autorizacion + codigo_medicamento). */
export const bulkUpdateOperationContracts = {
  ASSIGN_DISPENSATION_LOCATION: {
    actorOrganizationCode: 'MEDICARTE',
    permission: 'bulk_updates.dispensation_location',
    mutableField: 'LUGAR_DISPENSACION',
    requiredColumns: ['CLAVE_AUTORIZACION', 'LUGAR_DISPENSACION'],
  },
  REPORT_DISPENSATION_DATE: {
    actorOrganizationCode: 'OLP',
    permission: 'bulk_updates.dispensation_date',
    mutableField: 'FECHA_DISPENSACION',
    requiredColumns: ['CLAVE_AUTORIZACION', 'FECHA_DISPENSACION'],
  },
  REPORT_APPLICATION_DATE: {
    actorOrganizationCode: 'MEDICARTE',
    permission: 'bulk_updates.application_date',
    mutableField: 'FECHA_APLICACION',
    requiredColumns: ['CLAVE_AUTORIZACION', 'FECHA_APLICACION'],
  },
} as const satisfies Record<
  BulkUpdateOperationType,
  {
    actorOrganizationCode: string;
    permission: string;
    mutableField: string;
    requiredColumns: readonly string[];
  }
>;

/** Tipos habilitados al completar la Fase 5. */
export const enabledBulkUpdateOperationTypes = bulkUpdateOperationTypeSchema.options;
export const enabledBulkUpdateOperationTypeSchema = bulkUpdateOperationTypeSchema;

export const bulkUpdateBatchStatusSchema = z.enum([
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);
export type BulkUpdateBatchStatus = z.infer<typeof bulkUpdateBatchStatusSchema>;

/** Causales mínimas estables de SPEC-013 más el resultado exitoso por fila. */
export const bulkUpdateRowResultCodeSchema = z.enum([
  'ROW_UPDATED',
  'UNCHANGED_VALUE',
  'INVALID_FILE_FORMAT',
  'FILE_TOO_LARGE',
  'INVALID_HEADERS',
  'MISSING_BUSINESS_KEY',
  'DUPLICATE_KEY_IN_FILE',
  'AUTHORIZATION_ITEM_NOT_FOUND',
  'FORBIDDEN_ITEM_SCOPE',
  'OPERATION_NOT_ALLOWED',
  'MISSING_VALUE',
  'INVALID_VALUE_FORMAT',
  'INVALID_OPERATION_STATE',
  'VERSION_CONFLICT',
  'PROCESSING_ERROR',
]);
export type BulkUpdateRowResultCode = z.infer<typeof bulkUpdateRowResultCodeSchema>;

export const bulkUpdateRowResultMessages: Record<BulkUpdateRowResultCode, string> = {
  ROW_UPDATED: 'Valor operativo actualizado.',
  UNCHANGED_VALUE: 'El valor enviado es igual al vigente; no se actualizó.',
  INVALID_FILE_FORMAT: 'El archivo o el valor no cumple el formato técnico.',
  FILE_TOO_LARGE: 'El archivo supera el tamaño máximo permitido.',
  INVALID_HEADERS: 'Los encabezados no coinciden exactamente con el contrato del tipo.',
  MISSING_BUSINESS_KEY: 'Falta la llave de negocio del ítem.',
  DUPLICATE_KEY_IN_FILE: 'La llave aparece repetida dentro del archivo.',
  AUTHORIZATION_ITEM_NOT_FOUND: 'No existe un ítem para la llave enviada.',
  FORBIDDEN_ITEM_SCOPE: 'El ítem está fuera del alcance de la organización.',
  OPERATION_NOT_ALLOWED: 'La operación no está permitida para el estado actual del ítem.',
  MISSING_VALUE: 'Falta el valor del campo operativo.',
  INVALID_VALUE_FORMAT: 'El valor del campo operativo no cumple el formato esperado.',
  INVALID_OPERATION_STATE: 'El ítem no cumple la precondición operacional del tipo.',
  VERSION_CONFLICT: 'El ítem cambió durante el procesamiento.',
  PROCESSING_ERROR: 'No fue posible procesar la fila.',
};

export const BULK_UPDATES_QUEUE = 'bulk-updates';
export const BULK_UPDATES_DEAD_LETTER_QUEUE = 'bulk-updates.dead-letter';
export const BULK_UPDATE_JOB_NAME = 'authorization.bulk-update.v1';
export const BULK_UPDATE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};
export const BULK_UPDATE_CONTRACT_VERSION = 2;

export const bulkUpdateJobPayloadSchema = z.object({
  eventId: z.string().uuid(),
  batchId: z.string().uuid(),
  contractVersion: z.literal(BULK_UPDATE_CONTRACT_VERSION),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type BulkUpdateJobPayload = z.infer<typeof bulkUpdateJobPayloadSchema>;

export const bulkUpdateJobSchema = z.object({
  name: z.literal('authorization.bulk-update'),
  version: z.literal(BULK_UPDATE_CONTRACT_VERSION),
  payload: bulkUpdateJobPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type BulkUpdateJob = z.infer<typeof bulkUpdateJobSchema>;

export const bulkUpdateBatchResponseSchema = z.object({
  id: z.string().uuid(),
  operationType: bulkUpdateOperationTypeSchema,
  status: bulkUpdateBatchStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  contractVersion: z.number().int().positive(),
  totalRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  updatedRows: z.number().int().nonnegative(),
  unchangedRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  lastErrorCode: z.string().min(1).max(80).nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});
export type BulkUpdateBatchResponse = z.infer<typeof bulkUpdateBatchResponseSchema>;

export const bulkUpdateRowResponseSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  resultCode: bulkUpdateRowResultCodeSchema,
  resultMessage: z.string(),
  authorizationItemId: z.string().uuid().nullable(),
  authorizationKey: z.string().nullable(),
  fieldName: z.string().nullable(),
  previousValue: z.string().nullable(),
  newValue: z.string().nullable(),
  fieldVersion: z.number().int().nonnegative().nullable(),
  createdAt: isoDateTimeSchema,
});
export type BulkUpdateRowResponse = z.infer<typeof bulkUpdateRowResponseSchema>;

export const paginatedBulkUpdateRowsResponseSchema = z.object({
  items: z.array(bulkUpdateRowResponseSchema),
  nextCursor: z.string().nullable(),
});

export const notificationTypeSchema = z.enum([
  'AUTHORIZATION_READY_TO_DISPENSE',
  'DISPENSATION_LOCATION_ASSIGNED',
  'DISPENSATION_LOCATION_CHANGED',
  'EPS_DIRECTION_PENDING',
  'EPS_TARIFF_ANNEX_REJECTED',
  'DAILY_OPERATIONAL_REPORT',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Organización destinataria de cada tipo de notificación (SPEC-004). */
export const notificationRecipientOrganizations: Record<NotificationType, readonly string[]> = {
  AUTHORIZATION_READY_TO_DISPENSE: ['OLP', 'MEDICARTE'],
  DISPENSATION_LOCATION_ASSIGNED: ['OLP'],
  DISPENSATION_LOCATION_CHANGED: ['OLP'],
  EPS_DIRECTION_PENDING: ['COMPENSAR'],
  EPS_TARIFF_ANNEX_REJECTED: ['COMPENSAR'],
  DAILY_OPERATIONAL_REPORT: ['MTD', 'COMPENSAR', 'OLP', 'MEDICARTE'],
};

export const NOTIFICATIONS_QUEUE = 'notifications';
export const NOTIFICATIONS_DEAD_LETTER_QUEUE = 'notifications.dead-letter';
export const NOTIFICATION_JOB_NAME = 'notification.email.v1';
export const NOTIFICATION_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};

export const notificationJobPayloadSchema = z.object({
  eventId: z.string().uuid(),
  notificationType: notificationTypeSchema,
  itemId: z.string().uuid().nullable(),
  batchId: z.string().uuid().nullable().optional(),
  recipientOrganizationId: z.string().uuid().nullable(),
  /** Fecha calendario America/Bogota de la ventana consolidada. */
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type NotificationJobPayload = z.infer<typeof notificationJobPayloadSchema>;

export const notificationJobSchema = z.object({
  name: z.literal('notification.email'),
  version: z.literal(1),
  payload: notificationJobPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type NotificationJob = z.infer<typeof notificationJobSchema>;

export const notificationStatusSchema = z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

export const notificationResponseSchema = z.object({
  id: z.string().uuid(),
  notificationType: notificationTypeSchema,
  recipientOrganizationId: z.string().uuid().nullable(),
  itemId: z.string().uuid().nullable(),
  period: z.string().nullable(),
  status: notificationStatusSchema,
  attempts: z.number().int().nonnegative(),
  subject: z.string(),
  recipients: z.array(z.string().email()),
  templateVersion: z.number().int().positive(),
  gmailMessageId: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  sentAt: isoDateTimeSchema.nullable(),
});
export type NotificationResponse = z.infer<typeof notificationResponseSchema>;

export const notificationRecipientRequestSchema = z.object({
  notificationType: notificationTypeSchema,
  organizationId: z.string().uuid(),
  email: z.string().email().max(320),
});
export type NotificationRecipientRequest = z.infer<typeof notificationRecipientRequestSchema>;

export const notificationRecipientResponseSchema = z.object({
  id: z.string().uuid(),
  notificationType: notificationTypeSchema,
  organizationId: z.string().uuid(),
  email: z.string().email(),
  active: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type NotificationRecipientResponse = z.infer<typeof notificationRecipientResponseSchema>;

export const notificationListQuerySchema = z.object({
  status: notificationStatusSchema.optional(),
  notificationType: notificationTypeSchema.optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const operationalExportFormatSchema = z.enum(['csv', 'xlsx']);
export const operationalExportQuerySchema = z.object({
  operationType: bulkUpdateOperationTypeSchema,
  format: operationalExportFormatSchema.default('csv'),
});
export type OperationalExportQuery = z.infer<typeof operationalExportQuerySchema>;

// ---------------------------------------------------------------------------
// Fase 6 — Auditoría humana, hallazgos, consolidación e indicadores.
// Contratos compartidos web/api (SPEC-006, SPEC-002, ADR-009, ADR-016, ADR-018).
// ---------------------------------------------------------------------------

export const auditReviewListQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const paginatedAuditReviewsResponseSchema = z.object({
  items: z.array(auditReviewResponseSchema),
  nextCursor: z.string().nullable(),
});

/** Indicadores operativos derivados (lectura); nunca persistidos. */
export const operationalIndicatorsResponseSchema = z.object({
  byAuditStatus: z.record(auditStatusSchema, z.number().int().nonnegative()),
  byOperationStatus: z.record(operationStatusSchema, z.number().int().nonnegative()),
  byCoverageType: z.record(coverageTypeSchema, z.number().int().nonnegative()),
  pendingDispensationLocation: z.number().int().nonnegative(),
  assignedDispensationLocation: z.number().int().nonnegative(),
  pendingDispensationDate: z.number().int().nonnegative(),
  pendingApplicationDate: z.number().int().nonnegative(),
  readyForReview: z.number().int().nonnegative(),
  approvedForAdmission: z.number().int().nonnegative(),
});
export type OperationalIndicatorsResponse = z.infer<typeof operationalIndicatorsResponseSchema>;

/** Exportaciones on-demand: el consolidado por defecto solo incluye APPROVED. */
export const consolidatedExportQuerySchema = z.object({
  format: operationalExportFormatSchema.default('csv'),
  coverageType: coverageTypeSchema.exclude(['UNCLASSIFIED']).optional(),
  includeAll: z.preprocess(
    (value) =>
      value === undefined ? false : value === 'true' ? true : value === 'false' ? false : value,
    z.boolean(),
  ),
});
export type ConsolidatedExportQuery = z.infer<typeof consolidatedExportQuerySchema>;

/** ---- Gestión de usuarios (users.manage) ---- */

export const userAssignmentSchema = z.object({
  organizationId: z.string().uuid(),
  organizationCode: z.string(),
  organizationName: z.string(),
  roleCode: z.string(),
  active: z.boolean(),
});
export type UserAssignment = z.infer<typeof userAssignmentSchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  active: z.boolean(),
  passwordConfigured: z.boolean(),
  mustChangePassword: z.boolean(),
  assignments: z.array(userAssignmentSchema),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const userListQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const createUserRequestSchema = z.object({
  username: usernameSchema,
  email: z.string().email().max(320).optional(),
  displayName: z.string().min(1).max(160),
  password: newPasswordSchema,
  organizationId: z.string().uuid(),
  roleCode: z.string().min(1).max(80),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  displayName: z.string().min(1).max(160).optional(),
  active: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const resetUserPasswordRequestSchema = z.object({
  password: newPasswordSchema,
  mustChangePassword: z.boolean().optional(),
});
export type ResetUserPasswordRequest = z.infer<typeof resetUserPasswordRequestSchema>;

export const createAssignmentRequestSchema = z.object({
  organizationId: z.string().uuid(),
  roleCode: z.string().min(1).max(80),
});
export type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;

// ---------------------------------------------------------------------------
// Anexo Tarifario (SPEC-014 / ADR-024): catálogo MTD de códigos de producto
// habilitados. Contratos compartidos web/api/worker.
// ---------------------------------------------------------------------------

export const TARIFF_ANNEX_RULE_VERSION = 'TARIFF-ANNEX-1';

export const tariffMembershipStatusSchema = z.enum(['NOT_EVALUATED', 'LISTED', 'NOT_LISTED']);
export type TariffMembershipStatus = z.infer<typeof tariffMembershipStatusSchema>;

export type TariffAnnexSourceColumn = (typeof tariffAnnexSourceColumns)[number];
export const requiredTariffImportColumns = tariffAnnexSourceColumns;

export const tariffProductListQuerySchema = z.object({
  codigo: z.string().trim().min(1).max(255).optional(),
  active: z.enum(['true', 'false']).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type TariffProductListQuery = z.infer<typeof tariffProductListQuerySchema>;

export const createTariffProductRequestSchema = z.object({
  codigoProducto: z.string().trim().min(1).max(255),
  tarifaUnidad: z.string().trim().max(255).optional(),
  numeroExpedienteInvima: z.string().trim().max(255).optional(),
  consecutivoInvimaPresentacion: z.string().trim().max(255).optional(),
  descripcionGenerica: z.string().trim().max(1000).optional(),
  descripcionComercial: z.string().trim().max(1000).optional(),
  laboratorio: z.string().trim().max(500).optional(),
  tipoInclusion: z.string().trim().max(100).optional(),
});
export type CreateTariffProductRequest = z.infer<typeof createTariffProductRequestSchema>;

export const updateTariffProductRequestSchema = z.object({
  active: z.boolean(),
});
export type UpdateTariffProductRequest = z.infer<typeof updateTariffProductRequestSchema>;

export const tariffProductResponseSchema = z.object({
  id: z.string().uuid(),
  codigoProducto: z.string(),
  active: z.boolean(),
  version: z.number().int().positive(),
  createdBy: z.string().uuid(),
  tarifaUnidad: z.string().nullable(),
  numeroExpedienteInvima: z.string().nullable(),
  consecutivoInvimaPresentacion: z.string().nullable(),
  descripcionGenerica: z.string().nullable(),
  descripcionComercial: z.string().nullable(),
  laboratorio: z.string().nullable(),
  tipoInclusion: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TariffProductResponse = z.infer<typeof tariffProductResponseSchema>;

export const paginatedTariffProductsResponseSchema = z.object({
  items: z.array(tariffProductResponseSchema),
  nextCursor: z.string().nullable(),
});

export const createTariffProductResultSchema = z.enum([
  'PRODUCT_CREATED',
  'PRODUCT_EXISTING',
  'PRODUCT_REACTIVATED',
]);
export type CreateTariffProductResult = z.infer<typeof createTariffProductResultSchema>;

export const tariffImportStatusSchema = z.enum(['UPLOADED', 'VALIDATING', 'COMPLETED', 'FAILED']);
export type TariffImportStatus = z.infer<typeof tariffImportStatusSchema>;

export const tariffImportRowResultCodeSchema = z.enum([
  'PRODUCT_CREATED',
  'PRODUCT_REACTIVATED',
  'PRODUCT_EXISTING',
  'INVALID_PRODUCT_CODE',
  'DUPLICATE_IN_FILE',
  'INVALID_FILE_FORMAT',
  'PROCESSING_ERROR',
]);
export type TariffImportRowResultCode = z.infer<typeof tariffImportRowResultCodeSchema>;

export const tariffImportRowResultMessages: Record<TariffImportRowResultCode, string> = {
  PRODUCT_CREATED: 'Producto agregado al Anexo Tarifario.',
  PRODUCT_REACTIVATED: 'Producto reactivado en el Anexo Tarifario.',
  PRODUCT_EXISTING: 'Producto ya registrado y activo.',
  INVALID_PRODUCT_CODE: 'Código obligatorio vacío o con formato inválido.',
  DUPLICATE_IN_FILE: 'Código repetido dentro del archivo.',
  INVALID_FILE_FORMAT: 'El archivo no cumple el formato técnico.',
  PROCESSING_ERROR: 'No fue posible procesar la fila.',
};

export const tariffImportBatchResponseSchema = z.object({
  id: z.string().uuid(),
  status: tariffImportStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  totalRows: z.number().int().nonnegative(),
  createdRows: z.number().int().nonnegative(),
  reactivatedRows: z.number().int().nonnegative(),
  existingRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  lastErrorCode: z.string().min(1).max(80).nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});
export type TariffImportBatchResponse = z.infer<typeof tariffImportBatchResponseSchema>;

export const tariffImportRowResponseSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  codigoProducto: z.string().nullable(),
  resultCode: tariffImportRowResultCodeSchema,
  resultMessage: z.string(),
  productId: z.string().uuid().nullable(),
  createdAt: isoDateTimeSchema,
});
export type TariffImportRowResponse = z.infer<typeof tariffImportRowResponseSchema>;

export const paginatedTariffImportRowsResponseSchema = z.object({
  items: z.array(tariffImportRowResponseSchema),
  nextCursor: z.string().nullable(),
});

export const tariffImportListQuerySchema = z.object({
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const TARIFF_ANNEX_QUEUE = 'tariff-annex';
export const TARIFF_ANNEX_DEAD_LETTER_QUEUE = 'tariff-annex.dead-letter';
export const TARIFF_IMPORT_JOB_NAME = 'tariff.import.v1';
export const TARIFF_REVALIDATION_JOB_NAME = 'tariff.revalidation.v1';
export const TARIFF_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};

export const tariffImportPayloadSchema = z.object({
  eventId: z.string().uuid(),
  batchId: z.string().uuid(),
  sourceFileId: z.string().uuid(),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type TariffImportPayload = z.infer<typeof tariffImportPayloadSchema>;

export const tariffImportJobSchema = z.object({
  name: z.literal('tariff.import'),
  version: z.literal(1),
  payload: tariffImportPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type TariffImportJob = z.infer<typeof tariffImportJobSchema>;

export const tariffAnnexRevalidationPayloadSchema = z.object({
  eventId: z.string().uuid(),
  tariffProductId: z.string().uuid(),
  codigoProducto: z.string().min(1).max(255),
  actorId: z.string().uuid(),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type TariffAnnexRevalidationPayload = z.infer<typeof tariffAnnexRevalidationPayloadSchema>;

export const tariffAnnexRevalidationJobSchema = z.object({
  name: z.literal('tariff.product.activated'),
  version: z.literal(1),
  payload: tariffAnnexRevalidationPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type TariffAnnexRevalidationJob = z.infer<typeof tariffAnnexRevalidationJobSchema>;

export const epsNovedadCausalSchema = z.enum([
  'SOURCE_STATUS_BLOCKED',
  'AUTHORIZATION_EXPIRED',
  'DIRECTION_PENDING',
  'DIRECTION_QUERY_ERROR',
  'PRODUCT_NOT_IN_TARIFF_ANNEX',
]);
export type EpsNovedadCausal = z.infer<typeof epsNovedadCausalSchema>;

export const epsNovedadesExportQuerySchema = z.object({
  format: operationalExportFormatSchema.default('csv'),
});
export type EpsNovedadesExportQuery = z.infer<typeof epsNovedadesExportQuerySchema>;
