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
  status: z.literal('EN_COLA'),
  queryType: mipresQueryTypeSchema,
  correlationId: correlationIdSchema,
});
export type MipresRecheckRequestResponse = z.infer<typeof mipresRecheckRequestResponseSchema>;

/**
 * Estados de negocio y de procesamiento expuestos por la API.
 * Los valores son identificadores ASCII en español; códigos de error, eventos,
 * colas y tipos de operación permanecen como identificadores técnicos.
 */
export const importBatchStatusSchema = z.enum([
  'CARGADO',
  'VALIDANDO',
  'LISTO_PARA_CONFIRMAR',
  'CONFIRMANDO',
  'COMPLETADO',
  'FALLIDO',
  'CANCELADO',
  'REVIRTIENDO',
  'REVERTIDO',
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

export const enablementStatusSchema = z.enum(['HABILITADO', 'BLOQUEADO_POR_ESTADO_ORIGEN']);
export const coverageTypeSchema = z.enum(['UNCLASSIFIED', 'PBS', 'NO_PBS']);
export const directionStatusSchema = z.enum([
  'NO_APLICA',
  'PENDIENTE',
  'CONFIRMADO',
  'ERROR_DE_CONSULTA',
]);
export const operationStatusSchema = z.enum([
  'BLOQUEADO',
  'LISTO_PARA_DISPENSAR',
  'DISPENSACION_REPORTADA',
  'DISPENSADO',
  'VENCIDO',
]);
export const auditStatusSchema = z.enum([
  'NO_INICIADO',
  'LISTO',
  'EN_REVISION',
  'RECHAZADO',
  'APROBADO',
]);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

/** SPEC-002/ADR-009: admisión derivada por reglas de dominio; nunca editable por UI.
 * LISTO habilita la descarga de la base para el proceso externo de admisiones;
 * no existen estados de handoff en el núcleo (el alcance de Fase 6 cierra la plataforma). */
export const admissionStatusSchema = z.enum(['NO_LISTO', 'LISTO']);
export type AdmissionStatus = z.infer<typeof admissionStatusSchema>;
export const operationalDateSchema = z.string().date();

/** SPEC-014: resultado de la validación del Anexo Tarifario por ítem. */
export const tariffMembershipStatusSchema = z.enum([
  'NO_EVALUADO',
  'LISTADO',
  'NO_LISTADO',
]);
export type TariffMembershipStatus = z.infer<typeof tariffMembershipStatusSchema>;

/** Fase 4 (SPEC-011/ADR-020): estado de sitio derivado, nunca persistido. */
export const applicationSiteStatusSchema = z.enum(['PENDIENTE_ASIGNACION', 'ASIGNADO']);
export type ApplicationSiteStatus = z.infer<typeof applicationSiteStatusSchema>;
export const applicationDateStatusSchema = z.enum(['FALTANTE', 'PRESENTE']);
export type ApplicationDateStatus = z.infer<typeof applicationDateStatusSchema>;

export const authorizationSourceColumns = [
  'CODEPS',
  'NUMERO_AUTORIZACION',
  'TIP_DOCUMENTO',
  'NUM_DOCUMENTO',
  'NOMBRE_PACIENTE',
  'CPRG',
  'CDGN001',
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
  status: z.literal('COMPLETADO'),
  createdRows: z.number().int().nonnegative(),
  existingRows: z.number().int().nonnegative(),
  confirmedAt: isoDateTimeSchema,
});
export type ConfirmImportResponse = z.infer<typeof confirmImportResponseSchema>;

/**
 * ADR-023 / DEC-017: causales estables de bloqueo para la reversión de un cargue.
 * La selección de ítems es exclusivamente por created_from_batch_id; el causal
 * ITEM_NOT_CREATED_BY_BATCH es un invariante estructural del pipeline y no se
 * produce en tiempo de ejecución.
 */
export const importReversalBlockReasonSchema = z.enum([
  'ITEM_HAS_AUDIT_ACTIVITY',
  'ITEM_HAS_MIPRES_ACTIVITY',
  'ITEM_HAS_OPERATIONAL_UPDATES',
  'ITEM_HAS_NOTIFICATIONS',
  'ITEM_HAS_UPDATED_SOURCE_EVIDENCE',
  'ITEM_REFERENCED_BY_LATER_IMPORT',
]);
export type ImportReversalBlockReason = z.infer<typeof importReversalBlockReasonSchema>;

export const importReversalBlockReasonMessages: Record<ImportReversalBlockReason, string> = {
  ITEM_HAS_AUDIT_ACTIVITY:
    'Tiene actividad de auditoría (revisión iniciada o estado posterior a NO_INICIADO).',
  ITEM_HAS_MIPRES_ACTIVITY: 'Tiene consultas o direccionamientos MIPRES registrados.',
  ITEM_HAS_OPERATIONAL_UPDATES:
    'Tiene actualizaciones operativas o datos logísticos (lugar, dispensación o aplicación).',
  ITEM_HAS_NOTIFICATIONS: 'Tiene notificaciones operativas posteriores a la creación del cargue.',
  ITEM_HAS_UPDATED_SOURCE_EVIDENCE:
    'Su evidencia de origen fue reemplazada por una actualización explícita.',
  ITEM_REFERENCED_BY_LATER_IMPORT: 'Otro cargue posterior detectó o actualizó esta llave.',
};

export const importReversalBlockedItemSchema = z.object({
  itemId: z.string().uuid(),
  authorizationKey: z.string(),
  reasons: z.array(importReversalBlockReasonSchema).min(1),
});
export type ImportReversalBlockedItem = z.infer<typeof importReversalBlockedItemSchema>;

const importReversalSummaryFields = {
  itemsCreatedByBatch: z.number().int().nonnegative(),
  itemsEligibleForRemoval: z.number().int().nonnegative(),
  itemsBlocked: z.number().int().nonnegative(),
  blockedReasonCounts: z.array(
    z.object({ reason: importReversalBlockReasonSchema, count: z.number().int().nonnegative() }),
  ),
  /** Detalle acotado; truncated indica que la lista completa excede el límite. */
  blockedItems: z.array(importReversalBlockedItemSchema),
  blockedItemsTruncated: z.boolean(),
} as const;

export const importReversalPreviewResponseSchema = z.object({
  batchId: z.string().uuid(),
  batchStatus: importBatchStatusSchema,
  originalFilename: z.string(),
  createdAt: isoDateTimeSchema,
  createdBy: z.string().uuid(),
  createdByEmail: z.string(),
  createdByName: z.string().nullable(),
  totalRows: z.number().int().nonnegative(),
  confirmedRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  existingRows: z.number().int().nonnegative(),
  alreadyReverted: z.boolean(),
  revertedAt: isoDateTimeSchema.nullable(),
  revertedRemovedItems: z.number().int().nonnegative(),
  revertedBlockedItems: z.number().int().nonnegative(),
  ...importReversalSummaryFields,
});
export type ImportReversalPreviewResponse = z.infer<typeof importReversalPreviewResponseSchema>;

export const revertImportResponseSchema = z.object({
  batchId: z.string().uuid(),
  status: z.literal('REVERTIDO'),
  alreadyReverted: z.boolean(),
  evaluatedItems: z.number().int().nonnegative(),
  removedItems: z.number().int().nonnegative(),
  blockedItems: z.number().int().nonnegative(),
  blockedItemsDetail: z.array(importReversalBlockedItemSchema),
  blockedItemsTruncated: z.boolean(),
  revertedAt: isoDateTimeSchema,
});
export type RevertImportResponse = z.infer<typeof revertImportResponseSchema>;

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
  tariffMembershipStatus: tariffMembershipStatusSchema.optional(),
  applicationSiteStatus: applicationSiteStatusSchema.optional(),
  applicationDateStatus: applicationDateStatusSchema.optional(),
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
  tariffMembershipStatus: tariffMembershipStatusSchema,
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

export const auditReviewStatusSchema = z.enum(['EN_REVISION', 'APROBADO', 'RECHAZADO']);
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
    mutableField: 'lugar_dispensacion',
    valueColumn: 'lugar_dispensacion',
    requiredColumns: ['authorization_key', 'lugar_dispensacion'],
  },
  REPORT_DISPENSATION_DATE: {
    actorOrganizationCode: 'OLP',
    permission: 'bulk_updates.dispensation_date',
    mutableField: 'fecha_dispensacion',
    valueColumn: 'fecha_dispensacion',
    requiredColumns: ['authorization_key', 'fecha_dispensacion'],
  },
  REPORT_APPLICATION_DATE: {
    actorOrganizationCode: 'MEDICARTE',
    permission: 'bulk_updates.application_date',
    mutableField: 'fecha_aplicacion',
    valueColumn: 'fecha_aplicacion_medicamento',
    requiredColumns: ['authorization_key', 'fecha_aplicacion_medicamento'],
  },
} as const satisfies Record<
  BulkUpdateOperationType,
  {
    actorOrganizationCode: string;
    permission: string;
    mutableField: string;
    valueColumn: string;
    requiredColumns: readonly string[];
  }
>;

/** Tipos habilitados al completar la Fase 5. */
export const enabledBulkUpdateOperationTypes = bulkUpdateOperationTypeSchema.options;
export const enabledBulkUpdateOperationTypeSchema = bulkUpdateOperationTypeSchema;

export const bulkUpdateBatchStatusSchema = z.enum([
  'CARGADO',
  'EN_COLA',
  'PROCESANDO',
  'COMPLETADO',
  'FALLIDO',
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
export const BULK_UPDATE_CONTRACT_VERSION = 3;
const supportedBulkUpdateJobContractVersionSchema = z.union([z.literal(2), z.literal(3)]);

export const bulkUpdateJobPayloadSchema = z.object({
  eventId: z.string().uuid(),
  batchId: z.string().uuid(),
  contractVersion: supportedBulkUpdateJobContractVersionSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type BulkUpdateJobPayload = z.infer<typeof bulkUpdateJobPayloadSchema>;

export const bulkUpdateJobSchema = z.object({
  name: z.literal('authorization.bulk-update'),
  version: supportedBulkUpdateJobContractVersionSchema,
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
  resultCodeCounts: z.record(z.string(), z.number().int().nonnegative()),
});

export const notificationTypeSchema = z.enum([
  'AUTHORIZATION_READY_TO_DISPENSE',
  'DISPENSATION_LOCATION_ASSIGNED',
  'DISPENSATION_LOCATION_CHANGED',
  'EPS_DIRECTION_PENDING',
  'DAILY_OPERATIONAL_REPORT',
]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Organización destinataria de cada tipo de notificación (SPEC-004). */
export const notificationRecipientOrganizations: Record<NotificationType, readonly string[]> = {
  AUTHORIZATION_READY_TO_DISPENSE: ['OLP', 'MEDICARTE'],
  DISPENSATION_LOCATION_ASSIGNED: ['OLP'],
  DISPENSATION_LOCATION_CHANGED: ['OLP'],
  EPS_DIRECTION_PENDING: ['COMPENSAR'],
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

export const notificationStatusSchema = z.enum(['PENDIENTE', 'ENVIADO', 'FALLIDO', 'OMITIDO']);
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

/** Consolidado on-demand (ADR-018): solo APROBADO es elegible (SPEC-006). */
export const consolidatedExportQuerySchema = z.object({
  format: operationalExportFormatSchema.default('csv'),
  coverageType: coverageTypeSchema.exclude(['UNCLASSIFIED']).optional(),
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
  subject: z.string().nullable(),
  email: z.string().email(),
  displayName: z.string(),
  active: z.boolean(),
  assignments: z.array(userAssignmentSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const userListQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const createUserRequestSchema = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(160),
  password: z.string().min(8).max(72),
  organizationId: z.string().uuid(),
  roleCode: z.string().min(1).max(80),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  displayName: z.string().min(1).max(160).optional(),
  active: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const createAssignmentRequestSchema = z.object({
  organizationId: z.string().uuid(),
  roleCode: z.string().min(1).max(80),
});
export type CreateAssignmentRequest = z.infer<typeof createAssignmentRequestSchema>;

export const pendingUserStatusSchema = z.enum(['PENDIENTE', 'APROBADO', 'RECHAZADO']);
export type PendingUserStatus = z.infer<typeof pendingUserStatusSchema>;

export const pendingUserRequestSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  status: pendingUserStatusSchema,
  requestedAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
});
export type PendingUserRequest = z.infer<typeof pendingUserRequestSchema>;

export const approvePendingUserRequestSchema = z.object({
  organizationId: z.string().uuid(),
  roleCode: z.string().min(1).max(80),
});
export type ApprovePendingUserRequest = z.infer<typeof approvePendingUserRequestSchema>;

export const rejectPendingUserRequestSchema = z.object({}).strict();
export type RejectPendingUserRequest = z.infer<typeof rejectPendingUserRequestSchema>;

// ---------------------------------------------------------------------------
// SPEC-014 / ADR-024 — Anexo Tarifario (configuración administrativa MTD).
// Contratos compartidos web/api/worker (GLOBAL_RULES: no duplicar DTO/enums).
// ---------------------------------------------------------------------------

export const TARIFF_ANNEX_QUEUE = 'tariff-annex';
export const TARIFF_ANNEX_DEAD_LETTER_QUEUE = 'tariff-annex.dead-letter';
export const TARIFF_ANNEX_JOB_NAME = 'tariff.annex-revalidation.v1';
export const TARIFF_ANNEX_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};

export const createTariffProductRequestSchema = z.object({
  codigoProducto: z.string().trim().min(1).max(255),
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
  /** Evidencia de la fila mapeada del cargue (columnas del contrato comercial). */
  sourceData: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type TariffProductResponse = z.infer<typeof tariffProductResponseSchema>;

export const tariffProductListQuerySchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  codigo: z.string().trim().min(1).max(300).optional(),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TariffProductListQuery = z.infer<typeof tariffProductListQuerySchema>;

export const paginatedTariffProductsResponseSchema = z.object({
  items: z.array(tariffProductResponseSchema),
  nextCursor: z.string().nullable(),
});

export const createTariffProductResponseSchema = z.object({
  product: tariffProductResponseSchema,
  /** CREADO | EXISTENTE | REACTIVADO — resultado estable de la operación. */
  resultCode: z.enum(['PRODUCT_CREATED', 'PRODUCT_EXISTING', 'PRODUCT_REACTIVATED']),
});

/**
 * SPEC-014 §5 (DEC-019): contrato del cargue masivo del Anexo Tarifario.
 * Los encabezados son exactamente los del formato comercial acordado y la
 * igualdad de validación es `Código Interno Medicamento = COD_COMERCIAL`
 * (authorization_items.codigo_medicamento). Los códigos se intercambian como
 * TEXTO (nunca numéricos) para no perder ceros a la izquierda; las demás
 * columnas se conservan como evidencia del producto.
 */
export const tariffAnnexCodeColumn = 'Código Interno Medicamento' as const;

export const requiredTariffImportColumns = [
  'Código Interno Medicamento',
  'Tarifa de la unidad Farmacéutica',
  'Número de Expediente del INVIMA',
  'Consecutivo INVIMA (Presentación)',
  'Descripción Genérica del Medicamento (DCI)',
  'Descripción Comercial del Medicamento',
  'Laboratorio del Medicamento',
  'Tipo de Inclusion del Medicamento (PBS/NOPBS)',
] as const;

export const tariffImportBatchStatusSchema = z.enum([
  'CARGADO',
  'VALIDANDO',
  'COMPLETADO',
  'FALLIDO',
]);
export type TariffImportBatchStatus = z.infer<typeof tariffImportBatchStatusSchema>;

/** Catálogo cerrado de resultados por fila del cargue del Anexo Tarifario. */
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
  PRODUCT_EXISTING: 'Ya se encontraba registrado y activo.',
  INVALID_PRODUCT_CODE: 'Código de producto obligatorio o con formato inválido.',
  DUPLICATE_IN_FILE: 'Código repetido dentro del archivo.',
  INVALID_FILE_FORMAT: 'Estructura de archivo inválida.',
  PROCESSING_ERROR: 'No fue posible procesar la fila.',
};

export const tariffImportBatchResponseSchema = z.object({
  id: z.string().uuid(),
  status: tariffImportBatchStatusSchema,
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

export const tariffImportPayloadSchema = z.object({
  eventId: z.string().uuid(),
  batchId: z.string().uuid(),
  sourceFileId: z.string().uuid(),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const tariffImportJobSchema = z.object({
  name: z.literal('tariff.import'),
  version: z.literal(1),
  payload: tariffImportPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type TariffImportJob = z.infer<typeof tariffImportJobSchema>;

/**
 * SPEC-014 §16: evento de dominio por producto creado o reactivado. Provoca la
 * revalidación dirigida de autorizaciones bloqueadas por
 * PRODUCT_NOT_IN_TARIFF_ANNEX con ese código de medicamento.
 */
export const tariffAnnexRevalidationPayloadSchema = z.object({
  eventId: z.string().uuid(),
  tariffProductId: z.string().uuid(),
  codigoProducto: z.string().min(1).max(255),
  actorId: z.string().uuid().nullable(),
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const tariffAnnexRevalidationJobSchema = z.object({
  name: z.literal('tariff.product.activated'),
  version: z.literal(1),
  payload: tariffAnnexRevalidationPayloadSchema,
  correlationId: correlationIdSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type TariffAnnexRevalidationJob = z.infer<typeof tariffAnnexRevalidationJobSchema>;

export type TariffRevalidationResult = Readonly<{
  tariffProductId: string;
  codigoProducto: string;
  outcome: 'COMPLETADO' | 'OMITIDO' | 'DEDUPLICADO';
  skipReason?: string;
  evaluatedItems: number;
  revalidatedItems: number;
  becameReadyItems: number;
}>;

/** Descarga on-demand de novedades EPS (MTD): registros sin LISTO_PARA_DISPENSAR. */
export const epsNovedadesExportQuerySchema = z.object({
  format: operationalExportFormatSchema.default('csv'),
});
export type EpsNovedadesExportQuery = z.infer<typeof epsNovedadesExportQuerySchema>;
