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
export type FoundationJob = z.infer<typeof foundationJobSchema>;

export const FOUNDATION_QUEUE = 'foundation';
export const FOUNDATION_DEAD_LETTER_QUEUE = 'foundation.dead-letter';
export const FOUNDATION_JOB_NAME = 'foundation.event.v1';
export const FOUNDATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 500 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false,
};

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 160;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const usernameSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
  z
    .string()
    .min(USERNAME_MIN_LENGTH)
    .max(USERNAME_MAX_LENGTH)
    .regex(/^[a-z0-9][a-z0-9._@-]{1,158}$/, 'invalid username format'),
);
export type Username = z.infer<typeof usernameSchema>;

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
export type MeResponse = z.infer<typeof meResponseSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
  correlationId: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

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

export const userListQuerySchema = z.object({ active: z.enum(['true', 'false']).optional() });
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

export const commercialCodeSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.string().min(1).max(255),
);
export type CommercialCode = z.infer<typeof commercialCodeSchema>;

export const clinicalAuthorizationReferenceSchema = z.object({
  authorizationItemId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
});
export type ClinicalAuthorizationReference = z.infer<typeof clinicalAuthorizationReferenceSchema>;

export const planningPeriodStatusSchema = z.enum([
  'OPEN',
  'PLANNING_CLOSED',
  'PURCHASING',
  'IN_FULFILLMENT',
  'OPERATIONAL',
  'CLOSED',
]);
export type PlanningPeriodStatus = z.infer<typeof planningPeriodStatusSchema>;

/**
 * ESP-002: máquina de estados explícita y unidireccional. Solo se permite
 * avanzar una etapa; cada transición ocurre por una acción humana auditada.
 */
export const planningPeriodTransitions: Record<
  PlanningPeriodStatus,
  readonly PlanningPeriodStatus[]
> = {
  OPEN: ['PLANNING_CLOSED'],
  PLANNING_CLOSED: ['PURCHASING'],
  PURCHASING: ['IN_FULFILLMENT'],
  IN_FULFILLMENT: ['OPERATIONAL'],
  OPERATIONAL: ['CLOSED'],
  CLOSED: [],
};

export const planningPeriodResponseSchema = z.object({
  id: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  schedulingCutoffAt: isoDateTimeSchema,
  purchaseOrderDeadlineAt: isoDateTimeSchema,
  expectedDeliveryDate: z.string().date(),
  status: planningPeriodStatusSchema,
  version: z.number().int().positive(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PlanningPeriodResponse = z.infer<typeof planningPeriodResponseSchema>;

export const createPlanningPeriodRequestSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  schedulingCutoffAt: isoDateTimeSchema,
  purchaseOrderDeadlineAt: isoDateTimeSchema,
  expectedDeliveryDate: z.string().date(),
});
export type CreatePlanningPeriodRequest = z.infer<typeof createPlanningPeriodRequestSchema>;

export const updatePlanningPeriodRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  schedulingCutoffAt: isoDateTimeSchema.optional(),
  purchaseOrderDeadlineAt: isoDateTimeSchema.optional(),
  expectedDeliveryDate: z.string().date().optional(),
});
export type UpdatePlanningPeriodRequest = z.infer<typeof updatePlanningPeriodRequestSchema>;

export const transitionPlanningPeriodRequestSchema = z.object({
  to: planningPeriodStatusSchema,
  expectedVersion: z.number().int().positive(),
});
export type TransitionPlanningPeriodRequest = z.infer<typeof transitionPlanningPeriodRequestSchema>;

export const planningPeriodListQuerySchema = z.object({
  status: planningPeriodStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PlanningPeriodListQuery = z.infer<typeof planningPeriodListQuerySchema>;

export const paginatedPlanningPeriodsResponseSchema = z.object({
  items: z.array(planningPeriodResponseSchema),
});
export type PaginatedPlanningPeriodsResponse = z.infer<
  typeof paginatedPlanningPeriodsResponseSchema
>;

export const patientScheduleStatusSchema = z.enum(['SCHEDULED', 'RESCHEDULED', 'CANCELLED']);
export type PatientScheduleStatus = z.infer<typeof patientScheduleStatusSchema>;

/**
 * ESP-003 (invariante de negocio vigente): solo existe UNA programación
 * activa por (authorization_item_id, dispensing_point_id, scheduled_date).
 * La cantidad (quantity) representa las unidades autorizadas planeadas para
 * ese evento de aplicación y NO es parte de la identidad; de lo mismo, la
 * revisión tampoco lo es.
 *
 * Si el negocio llegara a requerir varios eventos de aplicación independientes
 * para la misma terna, el modelo debe introducir una dimensión de ocurrencia
 * explícita (scheduled_at / session / occurrence_id). Quantity y revision
 * NUNCA se usan para distinguir ocurrencias. Impuesta en la base de datos por
 * el índice único parcial `patient_schedules_active_identity_idx`
 * (migración 0034).
 */
export const PATIENT_SCHEDULE_IDENTITY_FIELDS = [
  'authorizationItemId',
  'dispensingPointId',
  'scheduledDate',
] as const;
export type PatientScheduleIdentityField = (typeof PATIENT_SCHEDULE_IDENTITY_FIELDS)[number];

/**
 * ESP-003: una programación puede reprogramarse cuantas veces haga falta
 * (SCHEDULED/RESCHEDULED → RESCHEDULED) y cancelarse una sola vez. CANCELLED
 * es terminal y no se elimina físicamente: solo registra una revisión.
 */
export const patientScheduleTransitions: Record<
  PatientScheduleStatus,
  readonly PatientScheduleStatus[]
> = {
  SCHEDULED: ['RESCHEDULED', 'CANCELLED'],
  RESCHEDULED: ['RESCHEDULED', 'CANCELLED'],
  CANCELLED: [],
};

export const scheduleTimingSchema = z.enum(['ON_TIME', 'LATE']);
export type ScheduleTiming = z.infer<typeof scheduleTimingSchema>;

export const lateHandlingSchema = z.enum(['COMPLEMENTARY_PURCHASE_ORDER', 'NEXT_PERIOD']);
export type LateHandling = z.infer<typeof lateHandlingSchema>;

export const patientScheduleChangeTypeSchema = z.enum([
  'CREATED',
  'UPDATED',
  'RESCHEDULED',
  'CANCELLED',
]);
export type PatientScheduleChangeType = z.infer<typeof patientScheduleChangeTypeSchema>;

export const expirationPriorityLevelSchema = z.enum(['CRITICAL', 'HIGH', 'NORMAL']);
export type ExpirationPriorityLevel = z.infer<typeof expirationPriorityLevelSchema>;

/**
 * ESP-003: única fuente de la política de vencimiento compartida por dominio,
 * API y Web. Valores OPERATIVOS INICIALES (no regla contractual de negocio):
 * la política se pasa explícitamente a `calculateAuthorizationPriority`, de
 * modo que ajustarla no requiere modificar el dominio. Cambiarla exige una
 * decisión documentada (está congelada con Object.freeze precisamente para
 * hacerlo visible).
 */
export const SCHEDULE_EXPIRATION_THRESHOLDS = Object.freeze({
  criticalDays: 15,
  highDays: 30,
});
export type ScheduleExpirationThresholds = typeof SCHEDULE_EXPIRATION_THRESHOLDS;

export const patientScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  authorizationItemId: z.string().uuid(),
  authorizationNumber: z.string(),
  planningPeriodId: z.string().uuid(),
  planningPeriodStartDate: z.string().date(),
  planningPeriodEndDate: z.string().date(),
  schedulingCutoffAt: isoDateTimeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  commercialCode: commercialCodeSchema,
  patientDocument: z.string().nullable(),
  patientName: z.string().nullable(),
  scheduledDate: z.string().date(),
  quantity: z.number().int().positive(),
  status: patientScheduleStatusSchema,
  scheduleTiming: scheduleTimingSchema,
  lateHandling: lateHandlingSchema.nullable(),
  deferredPlanningPeriodId: z.string().uuid().nullable(),
  revision: z.number().int().positive(),
  authorizationExpiresOn: z.string().date().nullable(),
  daysUntilExpiration: z.number().int().nullable(),
  priorityLevel: expirationPriorityLevelSchema.nullable(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PatientScheduleResponse = z.infer<typeof patientScheduleResponseSchema>;

export const createPatientScheduleRequestSchema = z.object({
  authorizationItemId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  scheduledDate: z.string().date(),
  quantity: z.number().int().positive(),
  lateHandling: lateHandlingSchema.optional(),
});
export type CreatePatientScheduleRequest = z.infer<typeof createPatientScheduleRequestSchema>;

export const updatePatientScheduleRequestSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    quantity: z.number().int().positive().optional(),
    dispensingPointId: z.string().uuid().optional(),
    scheduledDate: z.string().date().optional(),
    lateHandling: lateHandlingSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.quantity !== undefined ||
      value.dispensingPointId !== undefined ||
      value.scheduledDate !== undefined ||
      value.lateHandling !== undefined,
    { message: 'At least one change is required' },
  );
export type UpdatePatientScheduleRequest = z.infer<typeof updatePatientScheduleRequestSchema>;

export const reschedulePatientScheduleRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  scheduledDate: z.string().date(),
  dispensingPointId: z.string().uuid().optional(),
  lateHandling: lateHandlingSchema.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ReschedulePatientScheduleRequest = z.infer<
  typeof reschedulePatientScheduleRequestSchema
>;

export const cancelPatientScheduleRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CancelPatientScheduleRequest = z.infer<typeof cancelPatientScheduleRequestSchema>;

export const patientScheduleListQuerySchema = z.object({
  authorization: z.string().trim().min(1).max(255).optional(),
  patientDocument: z.string().trim().min(1).max(80).optional(),
  planningPeriodId: z.string().uuid().optional(),
  dispensingPointId: z.string().uuid().optional(),
  status: patientScheduleStatusSchema.optional(),
  commercialCode: commercialCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PatientScheduleListQuery = z.infer<typeof patientScheduleListQuerySchema>;

export const paginatedPatientSchedulesResponseSchema = z.object({
  items: z.array(patientScheduleResponseSchema),
});
export type PaginatedPatientSchedulesResponse = z.infer<
  typeof paginatedPatientSchedulesResponseSchema
>;

export const patientScheduleHistoryEntrySchema = z.object({
  patientScheduleId: z.string().uuid(),
  revision: z.number().int().positive(),
  changeType: patientScheduleChangeTypeSchema,
  authorizationItemId: z.string().uuid(),
  planningPeriodId: z.string().uuid(),
  dispensingPointId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  scheduledDate: z.string().date(),
  quantity: z.number().int().positive(),
  status: patientScheduleStatusSchema,
  scheduleTiming: scheduleTimingSchema,
  lateHandling: lateHandlingSchema.nullable(),
  deferredPlanningPeriodId: z.string().uuid().nullable(),
  changedBy: z.string().uuid(),
  correlationId: z.string().uuid(),
  changedAt: isoDateTimeSchema,
});
export type PatientScheduleHistoryEntry = z.infer<typeof patientScheduleHistoryEntrySchema>;

export const patientScheduleHistoryResponseSchema = z.object({
  items: z.array(patientScheduleHistoryEntrySchema),
});
export type PatientScheduleHistoryResponse = z.infer<typeof patientScheduleHistoryResponseSchema>;

/**
 * Búsqueda clínica acotada a programación. No reemplaza la búsqueda clínica
 * general: solo expone los datos mínimos para elegir un authorization_item.
 */
export const scheduleAuthorizationSearchQuerySchema = z
  .object({
    authorization: z.string().trim().min(1).max(255).optional(),
    patientDocument: z.string().trim().min(1).max(80).optional(),
    commercialCode: commercialCodeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine(
    (value) =>
      value.authorization !== undefined ||
      value.patientDocument !== undefined ||
      value.commercialCode !== undefined,
    { message: 'At least one search filter is required' },
  );
export type ScheduleAuthorizationSearchQuery = z.infer<
  typeof scheduleAuthorizationSearchQuerySchema
>;

export const scheduleAuthorizationOptionSchema = z.object({
  authorizationItemId: z.string().uuid(),
  authorizationNumber: z.string(),
  authorizationKey: z.string(),
  commercialCode: commercialCodeSchema,
  authorizedQuantity: z.number().int().positive().nullable(),
  patientDocument: z.string().nullable(),
  patientName: z.string().nullable(),
  coverageType: z.string(),
  directionStatus: z.string(),
  enablementStatus: z.string(),
  authorizationExpiresOn: z.string().date().nullable(),
  daysUntilExpiration: z.number().int().nullable(),
  priorityLevel: expirationPriorityLevelSchema.nullable(),
  canSchedule: z.boolean(),
  blockingCode: z.string().nullable(),
});
export type ScheduleAuthorizationOption = z.infer<typeof scheduleAuthorizationOptionSchema>;

export const scheduleAuthorizationSearchResponseSchema = z.object({
  items: z.array(scheduleAuthorizationOptionSchema),
});
export type ScheduleAuthorizationSearchResponse = z.infer<
  typeof scheduleAuthorizationSearchResponseSchema
>;

export const dispensingPointResponseSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type DispensingPointResponse = z.infer<typeof dispensingPointResponseSchema>;

export const dispensingPointListResponseSchema = z.object({
  items: z.array(dispensingPointResponseSchema),
});
export type DispensingPointListResponse = z.infer<typeof dispensingPointListResponseSchema>;

/** Vista previa de período/ON_TIME-LATE calculada por la API (regla ESP-002). */
export const scheduleTimingPreviewResponseSchema = z.object({
  planningPeriodId: z.string().uuid(),
  planningPeriodStartDate: z.string().date(),
  planningPeriodEndDate: z.string().date(),
  schedulingCutoffAt: isoDateTimeSchema,
  scheduleTiming: scheduleTimingSchema,
  lateHandlingRequired: z.boolean(),
  nextPlanningPeriodId: z.string().uuid().nullable(),
});
export type ScheduleTimingPreviewResponse = z.infer<typeof scheduleTimingPreviewResponseSchema>;

export const PATIENT_SCHEDULE_IMPORT_REQUIRED_COLUMNS = [
  'AUTORIZACION',
  'DOCUMENTO',
  'COD_COMERCIAL',
  'CANTIDAD',
  'PUNTO',
  'FECHA_PROGRAMADA',
] as const;

export const PATIENT_SCHEDULE_IMPORT_OPTIONAL_COLUMNS = ['MANEJO_TARDIO'] as const;

export const PATIENT_SCHEDULE_IMPORT_MAX_ROWS = 5000;

export const patientScheduleImportBatchStatusSchema = z.enum([
  'UPLOADED',
  'VALIDATING',
  'READY_TO_CONFIRM',
  'CONFIRMING',
  'COMPLETED',
  'FAILED',
]);
export type PatientScheduleImportBatchStatus = z.infer<
  typeof patientScheduleImportBatchStatusSchema
>;

export const patientScheduleImportRowStatusSchema = z.enum([
  'VALID',
  'INVALID',
  'DUPLICATE',
  'CONFLICT',
]);
export type PatientScheduleImportRowStatus = z.infer<
  typeof patientScheduleImportRowStatusSchema
>;

export const patientScheduleImportBatchResponseSchema = z.object({
  id: z.string().uuid(),
  status: patientScheduleImportBatchStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().length(64),
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  conflictRows: z.number().int().nonnegative(),
  confirmedRows: z.number().int().nonnegative(),
  lastErrorCode: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  confirmedAt: isoDateTimeSchema.nullable(),
});
export type PatientScheduleImportBatchResponse = z.infer<
  typeof patientScheduleImportBatchResponseSchema
>;

export const patientScheduleImportRowResponseSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  stagingStatus: patientScheduleImportRowStatusSchema,
  resultCode: z.string(),
  resultMessage: z.string().nullable(),
  patientDocument: z.string().nullable(),
  authorizationNumber: z.string().nullable(),
  commercialCode: z.string().nullable(),
  quantity: z.number().int().nullable(),
  dispensingPointCode: z.string().nullable(),
  scheduledDate: z.string().date().nullable(),
  scheduleTiming: scheduleTimingSchema.nullable(),
  lateHandling: lateHandlingSchema.nullable(),
  confirmable: z.boolean(),
  patientScheduleId: z.string().uuid().nullable(),
  confirmedAt: isoDateTimeSchema.nullable(),
});
export type PatientScheduleImportRowResponse = z.infer<
  typeof patientScheduleImportRowResponseSchema
>;

export const paginatedPatientScheduleImportRowsResponseSchema = z.object({
  items: z.array(patientScheduleImportRowResponseSchema),
});
export type PaginatedPatientScheduleImportRowsResponse = z.infer<
  typeof paginatedPatientScheduleImportRowsResponseSchema
>;

export const projectedDemandStatusSchema = z.enum(['OPEN', 'FROZEN', 'CLOSED']);
export type ProjectedDemandStatus = z.infer<typeof projectedDemandStatusSchema>;

export const clinicalAuthorizationResponseSchema = z.object({
  id: z.string().uuid(),
  numeroAutorizacion: z.string(),
  commercialCode: commercialCodeSchema,
  authorizationKey: z.string(),
  sourceStatusNormalized: z.string(),
  coverageType: z.string(),
  directionStatus: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ClinicalAuthorizationResponse = z.infer<typeof clinicalAuthorizationResponseSchema>;

export const legacyAuthorizationHistoryResponseSchema = z.object({
  id: z.string().uuid(),
  numeroAutorizacion: z.string(),
  commercialCode: commercialCodeSchema,
  lugarDispensacion: z.string().nullable(),
  fechaProgramada: z.string().date().nullable(),
  fechaDispensacion: z.string().date().nullable(),
  fechaAplicacion: z.string().date().nullable(),
  codAutorizacionMedicarte: z.string().nullable(),
  ordenCompra: z.string().nullable(),
  processStatus: z.string().nullable(),
  operationStatus: z.string().nullable(),
  operationalVersion: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
});
export type LegacyAuthorizationHistoryResponse = z.infer<
  typeof legacyAuthorizationHistoryResponseSchema
>;

export const projectedDemandListQuerySchema = z.object({
  planningPeriodId: z.string().uuid(),
  dispensingPointId: z.string().uuid().optional(),
  commercialCode: commercialCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ProjectedDemandListQuery = z.infer<typeof projectedDemandListQuerySchema>;

export const projectedDemandLineResponseSchema = z.object({
  id: z.string().uuid(),
  planningPeriodId: z.string().uuid(),
  planningPeriodStartDate: z.string().date(),
  planningPeriodEndDate: z.string().date(),
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  commercialCode: commercialCodeSchema,
  regularQuantity: z.number().int().nonnegative(),
  lateQuantity: z.number().int().nonnegative(),
  projectedQuantity: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  status: projectedDemandStatusSchema,
  revision: z.number().int().positive(),
  consolidatedAt: isoDateTimeSchema,
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
})
  .refine((value) => value.projectedQuantity === value.regularQuantity + value.lateQuantity, {
    message: 'projectedQuantity must equal regularQuantity + lateQuantity',
  })
  .refine((value) => value.projectedQuantity > 0 || value.sourceCount > 0, {
    message: 'projectedQuantity cannot be zero for a consolidated line',
  });
export type ProjectedDemandLineResponse = z.infer<typeof projectedDemandLineResponseSchema>;

export const paginatedProjectedDemandLinesResponseSchema = z.object({
  items: z.array(projectedDemandLineResponseSchema),
});
export type PaginatedProjectedDemandLinesResponse = z.infer<
  typeof paginatedProjectedDemandLinesResponseSchema
>;

export const projectedDemandSourceResponseSchema = z.object({
  patientScheduleId: z.string().uuid(),
  scheduleRevision: z.number().int().positive(),
  authorizationItemId: z.string().uuid(),
  authorizationNumber: z.string(),
  patientDocument: z.string().nullable(),
  patientName: z.string().nullable(),
  scheduledDate: z.string().date(),
  quantity: z.number().int().positive(),
  scheduleTiming: scheduleTimingSchema,
  lateHandling: lateHandlingSchema.nullable(),
});
export type ProjectedDemandSourceResponse = z.infer<typeof projectedDemandSourceResponseSchema>;

export const projectedDemandSourcesResponseSchema = z.object({
  items: z.array(projectedDemandSourceResponseSchema),
});
export type ProjectedDemandSourcesResponse = z.infer<typeof projectedDemandSourcesResponseSchema>;

export const consolidateProjectedDemandResponseSchema = z.object({
  planningPeriodId: z.string().uuid(),
  lineCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  regularQuantity: z.number().int().nonnegative(),
  lateQuantity: z.number().int().nonnegative(),
  projectedQuantity: z.number().int().nonnegative(),
  consolidatedAt: isoDateTimeSchema,
});
export type ConsolidateProjectedDemandResponse = z.infer<
  typeof consolidateProjectedDemandResponseSchema
>;
