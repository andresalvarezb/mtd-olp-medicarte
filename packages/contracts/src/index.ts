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

export const pointAccessKindSchema = z.enum(['global', 'explicit', 'unrestricted']);
export type PointAccessKind = z.infer<typeof pointAccessKindSchema>;

export const organizationPointAccessSchema = z.object({
  kind: pointAccessKindSchema,
  accessiblePointIds: z.array(z.string().uuid()),
});
export type OrganizationPointAccess = z.infer<typeof organizationPointAccessSchema>;

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
      pointAccess: organizationPointAccessSchema,
    }),
  ),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const POINT_ACCESS_DENIED = 'POINT_ACCESS_DENIED' as const;

export const operationalPointGrantSchema = z.object({
  id: z.string().uuid(),
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  active: z.boolean(),
  grantedAt: isoDateTimeSchema,
  grantedBy: z.string().uuid(),
});
export type OperationalPointGrant = z.infer<typeof operationalPointGrantSchema>;

export const operationalPointScopeResponseSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  organizationId: z.string().uuid(),
  organizationCode: z.string(),
  roles: z.array(z.string()),
  eligible: z.boolean(),
  grants: z.array(operationalPointGrantSchema),
});
export type OperationalPointScopeResponse = z.infer<typeof operationalPointScopeResponseSchema>;

export const replaceOperationalPointScopeRequestSchema = z.object({
  pointIds: z.array(z.string().uuid()),
});
export type ReplaceOperationalPointScopeRequest = z.infer<
  typeof replaceOperationalPointScopeRequestSchema
>;

export const assignableDispensingPointSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
});
export type AssignableDispensingPoint = z.infer<typeof assignableDispensingPointSchema>;

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

export const patientApplicationStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']);
export type PatientApplicationStatus = z.infer<typeof patientApplicationStatusSchema>;

export const patientApplicationLineRequestSchema = z.object({
  inventoryLotId: z.string().uuid(),
  quantity: z.number().int().positive(),
  fefoOverride: z.boolean().optional().default(false),
  fefoOverrideReason: z.string().trim().min(1).max(500).optional(),
});
export type PatientApplicationLineRequest = z.infer<typeof patientApplicationLineRequestSchema>;

export const createPatientApplicationRequestSchema = z.object({
  patientScheduleId: z.string().uuid(),
  scheduleRevision: z.number().int().positive(),
  applicationDate: z.string().date(),
  lines: z.array(patientApplicationLineRequestSchema).default([]),
});
export type CreatePatientApplicationRequest = z.infer<typeof createPatientApplicationRequestSchema>;

export const updatePatientApplicationRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  applicationDate: z.string().date().optional(),
  lines: z.array(patientApplicationLineRequestSchema).optional(),
});
export type UpdatePatientApplicationRequest = z.infer<typeof updatePatientApplicationRequestSchema>;

export const confirmPatientApplicationRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type ConfirmPatientApplicationRequest = z.infer<
  typeof confirmPatientApplicationRequestSchema
>;

export const cancelPatientApplicationRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export type CancelPatientApplicationRequest = z.infer<typeof cancelPatientApplicationRequestSchema>;

export const patientApplicationListQuerySchema = z.object({
  status: patientApplicationStatusSchema.optional(),
  patientScheduleId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PatientApplicationListQuery = z.infer<typeof patientApplicationListQuerySchema>;

export const patientApplicationLineSchema = patientApplicationLineRequestSchema.extend({
  id: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  lotNumber: z.string(),
  expirationDate: z.string().date(),
});
export type PatientApplicationLine = z.infer<typeof patientApplicationLineSchema>;

export const patientApplicationLotOptionSchema = z.object({
  id: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  lotNumber: z.string(),
  expirationDate: z.string().date(),
  physicalBalance: z.number().int(),
  usableBalance: z.number().int(),
  recommendedQuantity: z.number().int().nonnegative(),
});
export type PatientApplicationLotOption = z.infer<typeof patientApplicationLotOptionSchema>;

export const patientApplicationSchema = z.object({
  id: z.string().uuid(),
  patientScheduleId: z.string().uuid(),
  scheduleRevision: z.number().int().positive(),
  authorizationItemId: z.string().uuid(),
  authorizationNumber: z.string(),
  patientDocument: z.string().nullable(),
  patientName: z.string().nullable(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  scheduledDate: z.string().date(),
  applicationDate: z.string().date(),
  authorizationExpiresOn: z.string().date().nullable(),
  scheduledQuantity: z.number().int().positive(),
  selectedQuantity: z.number().int().nonnegative(),
  status: patientApplicationStatusSchema,
  version: z.number().int().positive(),
  createdBy: z.string().uuid(),
  confirmedBy: z.string().uuid().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  confirmedAt: isoDateTimeSchema.nullable(),
  lines: z.array(patientApplicationLineSchema),
  availableLots: z.array(patientApplicationLotOptionSchema),
});
export type PatientApplicationResponse = z.infer<typeof patientApplicationSchema>;

export const applicationAuditStatusSchema = z.enum([
  'READY_FOR_AUDIT',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
]);
export type ApplicationAuditStatus = z.infer<typeof applicationAuditStatusSchema>;

export const applicationAuditRejectionCodeSchema = z.enum([
  'APPLICATION_DATA_INCONSISTENT',
  'AUTHORIZATION_INCONSISTENT',
  'QUANTITY_INCONSISTENT',
  'PRODUCT_INCONSISTENT',
  'SUPPORT_MISSING',
  'OTHER',
]);
export type ApplicationAuditRejectionCode = z.infer<typeof applicationAuditRejectionCodeSchema>;

export const startApplicationAuditRequestSchema = z.object({});
export type StartApplicationAuditRequest = z.infer<typeof startApplicationAuditRequestSchema>;

export const approveApplicationAuditRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  evidenceReference: z.string().trim().min(1).max(1000).optional(),
});
export type ApproveApplicationAuditRequest = z.infer<typeof approveApplicationAuditRequestSchema>;

export const rejectApplicationAuditRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    rejectionCode: applicationAuditRejectionCodeSchema,
    observation: z.string().trim().min(1).max(1000).optional(),
    evidenceReference: z.string().trim().min(1).max(1000).optional(),
  })
  .superRefine((value, context) => {
    if (value.rejectionCode === 'OTHER' && !value.observation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['observation'],
        message: 'OTHER requires observation',
      });
    }
  });
export type RejectApplicationAuditRequest = z.infer<typeof rejectApplicationAuditRequestSchema>;

export const applicationAuditListQuerySchema = z.object({
  status: applicationAuditStatusSchema.optional(),
  applicationDateFrom: z.string().date().optional(),
  applicationDateTo: z.string().date().optional(),
  patientDocument: z.string().trim().min(1).max(255).optional(),
  authorization: z.string().trim().min(1).max(255).optional(),
  commercialCode: commercialCodeSchema.optional(),
  dispensingPointId: z.string().uuid().optional(),
  auditorId: z.string().uuid().optional(),
  priorityLevel: z.enum(['CRITICAL', 'HIGH', 'NORMAL']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type ApplicationAuditListQuery = z.infer<typeof applicationAuditListQuerySchema>;

export const applicationAuditLineSchema = z.object({
  id: z.string().uuid(),
  inventoryLotId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  lotNumber: z.string(),
  expirationDate: z.string().date(),
  quantity: z.number().int().positive(),
});
export type ApplicationAuditLine = z.infer<typeof applicationAuditLineSchema>;

export const applicationAuditMovementSchema = z.object({
  id: z.string().uuid(),
  inventoryLotId: z.string().uuid(),
  movementType: z.literal('APPLICATION'),
  quantityDelta: z.number().int().negative(),
  sourceType: z.literal('APPLICATION_LINE'),
  sourceId: z.string().uuid(),
  occurredAt: isoDateTimeSchema,
});
export type ApplicationAuditMovement = z.infer<typeof applicationAuditMovementSchema>;

export const applicationAuditResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  status: applicationAuditStatusSchema,
  patientApplicationId: z.string().uuid(),
  patientScheduleId: z.string().uuid(),
  scheduleRevision: z.number().int().positive(),
  applicationRevision: z.number().int().positive(),
  applicationVersion: z.number().int().positive(),
  authorizationItemId: z.string().uuid(),
  authorizationNumber: z.string(),
  patientDocument: z.string().nullable(),
  patientName: z.string().nullable(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  scheduledDate: z.string().date(),
  applicationDate: z.string().date(),
  scheduledQuantity: z.number().int().positive(),
  appliedQuantity: z.number().int().positive(),
  operationalStatus: z.literal('APPLIED'),
  admissionStatus: z.enum(['NOT_READY', 'READY']),
  authorizationExpiresOn: z.string().date().nullable(),
  daysUntilExpiration: z.number().int().nullable(),
  priorityLevel: z.enum(['CRITICAL', 'HIGH', 'NORMAL']).nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  startedBy: z.string().uuid().nullable(),
  startedByName: z.string().nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decidedBy: z.string().uuid().nullable(),
  decidedByName: z.string().nullable(),
  rejectionCode: applicationAuditRejectionCodeSchema.nullable(),
  observation: z.string().nullable(),
  evidenceReference: z.string().nullable(),
  version: z.number().int().positive().nullable(),
  lines: z.array(applicationAuditLineSchema),
  movements: z.array(applicationAuditMovementSchema),
});
export type ApplicationAuditResponse = z.infer<typeof applicationAuditResponseSchema>;

export const patientOperationalStatusSchema = z.enum([
  'SCHEDULED',
  'APPLIED',
  'NOT_APPLIED',
  'CANCELLED',
]);
export type PatientOperationalStatus = z.infer<typeof patientOperationalStatusSchema>;

export const patientOperationalNoveltySchema = z.enum([
  'PATIENT_NO_SHOW',
  'INCORRECT_PRESCRIPTION',
  'PRODUCT_NOT_CONTRACTED',
  'AUTHORIZATION_CANCELLED',
  'INSUFFICIENT_STOCK',
  'RESCHEDULED',
  'OTHER',
]);
export type PatientOperationalNovelty = z.infer<typeof patientOperationalNoveltySchema>;

export const preparedProductDispositionSchema = z.enum([
  'NOT_PREPARED',
  'REUSABLE',
  'NON_REUSABLE',
]);
export type PreparedProductDisposition = z.infer<typeof preparedProductDispositionSchema>;

export const nonReusableOutcomeLineRequestSchema = z.object({
  inventoryLotId: z.string().uuid(),
  quantity: z.number().int().positive(),
});
export type NonReusableOutcomeLineRequest = z.infer<typeof nonReusableOutcomeLineRequestSchema>;

export const markPatientNotAppliedRequestSchema = z.object({
  expectedScheduleRevision: z.number().int().positive(),
  noveltyCode: patientOperationalNoveltySchema,
  occurredOn: z.string().date(),
  observation: z.string().trim().min(1).max(1000).optional(),
  preparedProductDisposition: preparedProductDispositionSchema,
  nonReusableLines: z.array(nonReusableOutcomeLineRequestSchema).default([]),
});
export type MarkPatientNotAppliedRequest = z.infer<typeof markPatientNotAppliedRequestSchema>;

export const patientOperationalOutcomeSchema = z.object({
  id: z.string().uuid(),
  patientScheduleId: z.string().uuid(),
  scheduleRevision: z.number().int().positive(),
  authorizationItemId: z.string().uuid(),
  outcome: z.literal('NOT_APPLIED'),
  noveltyCode: patientOperationalNoveltySchema,
  occurredOn: z.string().date(),
  observation: z.string().nullable(),
  preparedProductDisposition: preparedProductDispositionSchema,
  createdBy: z.string().uuid(),
  createdAt: isoDateTimeSchema,
  lines: z.array(
    nonReusableOutcomeLineRequestSchema.extend({
      id: z.string().uuid(),
      commercialCode: commercialCodeSchema,
      dispensingPointId: z.string().uuid(),
      lotNumber: z.string(),
      expirationDate: z.string().date(),
    }),
  ),
});
export type PatientOperationalOutcomeResponse = z.infer<typeof patientOperationalOutcomeSchema>;

export const operationalStatusResponseSchema = z.object({
  patientScheduleId: z.string().uuid(),
  scheduleRevision: z.number().int().positive(),
  authorizationItemId: z.string().uuid(),
  authorizationNumber: z.string(),
  patientDocument: z.string().nullable(),
  patientName: z.string().nullable(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  scheduledDate: z.string().date(),
  quantity: z.number().int().positive(),
  planningStatus: z.enum(['SCHEDULED', 'RESCHEDULED', 'CANCELLED']),
  operationalStatus: patientOperationalStatusSchema,
  noveltyCode: patientOperationalNoveltySchema.nullable(),
  disposition: preparedProductDispositionSchema.nullable(),
  occurredOn: z.string().date().nullable(),
  authorizationExpiresOn: z.string().date().nullable(),
  daysUntilExpiration: z.number().int().nullable(),
  priorityLevel: z.enum(['CRITICAL', 'HIGH', 'NORMAL']).nullable(),
  outcomeId: z.string().uuid().nullable(),
  applicationId: z.string().uuid().nullable(),
});
export type OperationalStatusResponse = z.infer<typeof operationalStatusResponseSchema>;

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
export type PatientScheduleImportRowStatus = z.infer<typeof patientScheduleImportRowStatusSchema>;

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

/** Historical compatibility contract. Not a modern operational API. ESP-016. */
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

export const projectedDemandLineResponseSchema = z
  .object({
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

export const purchaseOrderTypeSchema = z.enum(['STANDARD', 'COMPLEMENTARY']);
export type PurchaseOrderType = z.infer<typeof purchaseOrderTypeSchema>;
export const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'ISSUED',
  'UNDER_OLP_REVIEW',
  'ACCEPTED',
  'PARTIALLY_ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'IN_FULFILLMENT',
  'PARTIALLY_DISPATCHED',
  'FULLY_DISPATCHED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
]);
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;
export const purchaseOrderTransitions: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> =
  {
    DRAFT: ['ISSUED', 'CANCELLED'],
    ISSUED: ['UNDER_OLP_REVIEW', 'CANCELLED'],
    UNDER_OLP_REVIEW: ['ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED'],
    ACCEPTED: ['IN_FULFILLMENT', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED'],
    PARTIALLY_ACCEPTED: ['IN_FULFILLMENT', 'PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED'],
    IN_FULFILLMENT: ['PARTIALLY_DISPATCHED', 'FULLY_DISPATCHED'],
    PARTIALLY_DISPATCHED: ['FULLY_DISPATCHED'],
    FULLY_DISPATCHED: ['PARTIALLY_RECEIVED', 'RECEIVED'],
    PARTIALLY_RECEIVED: ['RECEIVED'],
    RECEIVED: [],
    REJECTED: [],
    CANCELLED: [],
  };
export const purchaseOrderDemandBucketSchema = z.enum(['REGULAR', 'LATE']);
export type PurchaseOrderDemandBucket = z.infer<typeof purchaseOrderDemandBucketSchema>;

export const purchaseOrderLineRequestSchema = z.object({
  projectedDemandLineId: z.string().uuid(),
  expectedDemandRevision: z.number().int().positive(),
  requestedQuantity: z.number().int().positive(),
  requestedDeliveryDate: z.string().date(),
  demandBucket: purchaseOrderDemandBucketSchema,
});
export type PurchaseOrderLineRequest = z.infer<typeof purchaseOrderLineRequestSchema>;
export const createPurchaseOrderRequestSchema = z.object({
  planningPeriodId: z.string().uuid(),
  orderType: purchaseOrderTypeSchema,
  purchaseOrderCode: z.string().trim().min(1).max(255).optional(),
  lines: z.array(purchaseOrderLineRequestSchema).min(1),
});
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequestSchema>;
export const updatePurchaseOrderRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  purchaseOrderCode: z.string().trim().min(1).max(255).optional(),
  lines: z.array(purchaseOrderLineRequestSchema).min(1).optional(),
});
export type UpdatePurchaseOrderRequest = z.infer<typeof updatePurchaseOrderRequestSchema>;
export const reviewPurchaseOrderLineRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  acceptedQuantity: z.number().int().nonnegative(),
  supplierUnitCost: z.number().positive().optional(),
});
export type ReviewPurchaseOrderLineRequest = z.infer<typeof reviewPurchaseOrderLineRequestSchema>;
export const purchaseOrderListQuerySchema = z.object({
  planningPeriodId: z.string().uuid().optional(),
  status: purchaseOrderStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type PurchaseOrderListQuery = z.infer<typeof purchaseOrderListQuerySchema>;
export const purchaseOrderLineResponseSchema = z.object({
  id: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  productDescription: z.string().nullable(),
  presentation: z.string().nullable(),
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  requestedQuantity: z.number().int().positive(),
  acceptedQuantity: z.number().int().nonnegative().nullable(),
  shortage: z.number().int().nonnegative(),
  requestedDeliveryDate: z.string().date(),
  compensarUnitRateSnapshot: z.string(),
  supplierUnitCost: z.string().nullable(),
  projectedDemandLineId: z.string().uuid(),
  projectedDemandRevision: z.number().int().positive(),
  demandBucket: purchaseOrderDemandBucketSchema,
  allocatedQuantity: z.number().int().positive(),
  sourceDemandChanged: z.boolean(),
});
export type PurchaseOrderLineResponse = z.infer<typeof purchaseOrderLineResponseSchema>;
export const purchaseOrderResponseSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderCode: z.string().nullable(),
  planningPeriodId: z.string().uuid(),
  orderType: purchaseOrderTypeSchema,
  status: purchaseOrderStatusSchema,
  version: z.number().int().positive(),
  issuedAt: isoDateTimeSchema.nullable(),
  issuedBy: z.string().uuid().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lines: z.array(purchaseOrderLineResponseSchema),
});
export type PurchaseOrderResponse = z.infer<typeof purchaseOrderResponseSchema>;

export const deliveryStatusSchema = z.enum(['DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED']);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export const deliveryLineRequestSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  quantity: z.number().int().positive(),
  lotNumber: z.string().trim().min(1).max(255),
  expirationDate: z.string().date(),
});
export type DeliveryLineRequest = z.infer<typeof deliveryLineRequestSchema>;
export const createDeliveryRequestSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  supplierReference: z.string().trim().min(1).max(255).optional(),
  lines: z.array(deliveryLineRequestSchema).min(1),
});
export type CreateDeliveryRequest = z.infer<typeof createDeliveryRequestSchema>;
export const updateDeliveryRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  supplierReference: z.string().trim().min(1).max(255).optional(),
  lines: z.array(deliveryLineRequestSchema).min(1),
});
export type UpdateDeliveryRequest = z.infer<typeof updateDeliveryRequestSchema>;
export const deliveryActionRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export const deliveryLineResponseSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderLineId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  productDescription: z.string().nullable(),
  presentation: z.string().nullable(),
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  quantity: z.number().int().positive(),
  lotNumber: z.string(),
  expirationDate: z.string().date(),
  acceptedQuantity: z.number().int().nonnegative(),
  dispatchedQuantity: z.number().int().nonnegative(),
  remainingQuantity: z.number().int().nonnegative(),
});
export type DeliveryLineResponse = z.infer<typeof deliveryLineResponseSchema>;
export const deliveryResponseSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  purchaseOrderCode: z.string().nullable(),
  supplierReference: z.string().nullable(),
  status: deliveryStatusSchema,
  dispatchedAt: isoDateTimeSchema.nullable(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  lines: z.array(deliveryLineResponseSchema),
});
export type DeliveryResponse = z.infer<typeof deliveryResponseSchema>;

export const receiptStatusSchema = z.enum(['DRAFT', 'CONFIRMED']);
export const receiptConformitySchema = z.enum([
  'CONFORMING',
  'PARTIALLY_CONFORMING',
  'NON_CONFORMING',
]);
export const receiptReasonSchema = z.enum([
  'QUANTITY_SHORTAGE',
  'DAMAGED_PRODUCT',
  'LOT_MISMATCH',
  'EXPIRATION_MISMATCH',
  'EXPIRED_PRODUCT',
  'PACKAGING_ISSUE',
  'OTHER',
]);
export const receiptLineRequestSchema = z.object({
  deliveryLineId: z.string().uuid(),
  receivedQuantity: z.number().int().nonnegative(),
  acceptedQuantity: z.number().int().nonnegative(),
  rejectedQuantity: z.number().int().nonnegative(),
  receivedLotNumber: z.string().trim().max(255).optional().nullable(),
  receivedExpirationDate: z.string().date().optional().nullable(),
  conformity: receiptConformitySchema.optional(),
  nonconformityReason: receiptReasonSchema.optional().nullable(),
  observation: z.string().trim().max(2000).optional().nullable(),
});
export type ReceiptLineRequest = z.infer<typeof receiptLineRequestSchema>;
export const createReceiptRequestSchema = z.object({ deliveryId: z.string().uuid() });
export type CreateReceiptRequest = z.infer<typeof createReceiptRequestSchema>;
export const updateReceiptRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  receivedAt: isoDateTimeSchema.optional(),
  lines: z.array(receiptLineRequestSchema).min(1),
});
export type UpdateReceiptRequest = z.infer<typeof updateReceiptRequestSchema>;
export const confirmReceiptRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export const receiptLineResponseSchema = receiptLineRequestSchema.extend({
  id: z.string().uuid(),
  dispatchedQuantity: z.number().int().nonnegative(),
  shortageQuantity: z.number().int().nonnegative(),
  expectedLotNumber: z.string(),
  expectedExpirationDate: z.string().date(),
});
export const receiptResponseSchema = z.object({
  id: z.string().uuid(),
  deliveryId: z.string().uuid(),
  status: receiptStatusSchema,
  conformity: receiptConformitySchema.nullable(),
  receivedAt: isoDateTimeSchema,
  confirmedAt: isoDateTimeSchema.nullable(),
  version: z.number().int().positive(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  lines: z.array(receiptLineResponseSchema),
});
export type ReceiptResponse = z.infer<typeof receiptResponseSchema>;

export const inventoryMovementTypeSchema = z.enum([
  'RECEIPT',
  'APPLICATION',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'DAMAGE',
  'EXPIRATION',
  'RETURN_TO_SUPPLIER',
  'ADJUSTMENT',
  'NON_REUSABLE',
]);
export type InventoryMovementType = z.infer<typeof inventoryMovementTypeSchema>;
export const inventoryLotResponseSchema = z.object({
  id: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  lotNumber: z.string(),
  expirationDate: z.string().date(),
  physicalBalance: z.number().int(),
  usableBalance: z.number().int(),
  expired: z.boolean(),
});
export type InventoryLotResponse = z.infer<typeof inventoryLotResponseSchema>;
export const inventoryMovementResponseSchema = z.object({
  id: z.string().uuid(),
  inventoryLotId: z.string().uuid(),
  movementType: inventoryMovementTypeSchema,
  quantityDelta: z.number().int(),
  sourceType: z.string(),
  sourceId: z.string().uuid(),
  occurredAt: isoDateTimeSchema,
  createdBy: z.string().uuid().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: isoDateTimeSchema,
});
export type InventoryMovementResponse = z.infer<typeof inventoryMovementResponseSchema>;

export const stockTransferStatusSchema = z.enum(['CREATED', 'DISPATCHED', 'RECEIVED', 'CANCELLED']);
export type StockTransferStatus = z.infer<typeof stockTransferStatusSchema>;
export const stockTransferLineRequestSchema = z.object({
  sourceInventoryLotId: z.string().uuid(),
  quantity: z.number().int().positive(),
});
export type StockTransferLineRequest = z.infer<typeof stockTransferLineRequestSchema>;
export const createStockTransferRequestSchema = z.object({
  sourceDispensingPointId: z.string().uuid(),
  destinationDispensingPointId: z.string().uuid(),
  lines: z.array(stockTransferLineRequestSchema).min(1),
});
export type CreateStockTransferRequest = z.infer<typeof createStockTransferRequestSchema>;
export const updateStockTransferRequestSchema = createStockTransferRequestSchema.extend({
  expectedVersion: z.number().int().positive(),
});
export type UpdateStockTransferRequest = z.infer<typeof updateStockTransferRequestSchema>;
export const stockTransferActionRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export const stockTransferLineResponseSchema = z.object({
  id: z.string().uuid(),
  sourceInventoryLotId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  lotNumber: z.string(),
  expirationDate: z.string().date(),
  quantity: z.number().int().positive(),
  sourceUsableBalance: z.number().int(),
  destinationPhysicalBalance: z.number().int(),
});
export const stockTransferResponseSchema = z.object({
  id: z.string().uuid(),
  sourceDispensingPointId: z.string().uuid(),
  sourceDispensingPointCode: z.string(),
  sourceDispensingPointName: z.string(),
  destinationDispensingPointId: z.string().uuid(),
  destinationDispensingPointCode: z.string(),
  destinationDispensingPointName: z.string(),
  status: stockTransferStatusSchema,
  dispatchedAt: isoDateTimeSchema.nullable(),
  receivedAt: isoDateTimeSchema.nullable(),
  version: z.number().int().positive(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  inTransit: z.number().int().nonnegative(),
  globalControlledQuantity: z.number().int(),
  lines: z.array(stockTransferLineResponseSchema),
});
export type StockTransferResponse = z.infer<typeof stockTransferResponseSchema>;
export const stockTransferListQuerySchema = z.object({
  status: stockTransferStatusSchema.optional(),
});

const decimalMoneySchema = z.string().regex(/^-?\d+\.\d{2}$/);
const ratioSchema = z.string().regex(/^-?\d+\.\d{4}$/);

export const analyticsRatioMetricSchema = z.object({
  numerator: z.number().int(),
  denominator: z.number().int().nonnegative(),
  rate: ratioSchema.nullable(),
});
export type AnalyticsRatioMetric = z.infer<typeof analyticsRatioMetricSchema>;

export const analyticsMoneyMetricSchema = z.object({
  availability: z.enum(['EXACT', 'UNAVAILABLE']),
  value: decimalMoneySchema.nullable(),
  reason: z.string().nullable(),
  basis: z.enum(['PURCHASE_ORDER_SNAPSHOT', 'PERIOD_EFFECTIVE_TARIFF']).nullable(),
});
export type AnalyticsMoneyMetric = z.infer<typeof analyticsMoneyMetricSchema>;

export const analyticsQuerySchema = z.object({
  planningPeriodId: z.string().uuid().optional(),
  dispensingPointId: z.string().uuid().optional(),
  commercialCode: commercialCodeSchema.optional(),
  orderType: z.enum(['STANDARD', 'COMPLEMENTARY']).optional(),
  demandBucket: z.enum(['REGULAR', 'LATE']).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  operationalStatus: z.enum(['APPLIED', 'NOT_APPLIED']).optional(),
  noveltyCode: patientOperationalNoveltySchema.optional(),
  auditStatus: applicationAuditStatusSchema.optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const analyticsDrilldownKindSchema = z.enum([
  'projected',
  'ordered',
  'accepted',
  'dispatched',
  'received',
  'applied',
  'not_applied',
  'audit',
]);
export type AnalyticsDrilldownKind = z.infer<typeof analyticsDrilldownKindSchema>;

export const analyticsDrilldownQuerySchema = analyticsQuerySchema.extend({
  kind: analyticsDrilldownKindSchema,
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type AnalyticsDrilldownQuery = z.infer<typeof analyticsDrilldownQuerySchema>;

export const analyticsDemandSchema = z.object({
  regularProjectedQuantity: z.number().int().nonnegative(),
  lateProjectedQuantity: z.number().int().nonnegative(),
  projectedQuantity: z.number().int().nonnegative(),
  lastConsolidatedAt: isoDateTimeSchema.nullable(),
  stale: z.boolean(),
});
export type AnalyticsDemand = z.infer<typeof analyticsDemandSchema>;

export const analyticsProcurementSchema = z.object({
  requestedQuantity: z.number().int().nonnegative(),
  acceptedQuantity: z.number().int().nonnegative(),
  supplierShortageQuantity: z.number().int().nonnegative(),
  effectivePurchaseCoverage: z.number().int().nonnegative(),
  procurementGapQuantity: z.number().int().nonnegative(),
  purchaseCoverageRate: analyticsRatioMetricSchema,
  supplierAcceptanceRate: analyticsRatioMetricSchema,
});
export type AnalyticsProcurement = z.infer<typeof analyticsProcurementSchema>;

export const analyticsDeliverySchema = z.object({
  dispatchedQuantity: z.number().int().nonnegative(),
  deliveryPendingQuantity: z.number().int().nonnegative(),
  dispatchFulfillmentRate: analyticsRatioMetricSchema,
});
export type AnalyticsDelivery = z.infer<typeof analyticsDeliverySchema>;

export const analyticsReceiptSchema = z.object({
  physicallyReceivedQuantity: z.number().int().nonnegative(),
  acceptedIntoInventoryQuantity: z.number().int().nonnegative(),
  rejectedQuantity: z.number().int().nonnegative(),
  receiptPhysicalShortageQuantity: z.number().int().nonnegative(),
  receiptAcceptanceRate: analyticsRatioMetricSchema,
});
export type AnalyticsReceipt = z.infer<typeof analyticsReceiptSchema>;

export const analyticsApplicationSchema = z.object({
  appliedQuantity: z.number().int().nonnegative(),
  applicationRate: analyticsRatioMetricSchema,
});
export type AnalyticsApplication = z.infer<typeof analyticsApplicationSchema>;

export const analyticsInventorySchema = z.object({
  currentOnHandQuantity: z.number().int(),
  usableBalance: z.number().int().nonnegative(),
  inTransitQuantity: z.number().int().nonnegative(),
  expiredPhysicalQuantity: z.number().int().nonnegative(),
  upcomingExpirationQuantity: z.number().int().nonnegative(),
  nonReusableQuantity: z.number().int().nonnegative(),
  receivedMinusAppliedFlow: z.object({
    value: z.number().int(),
    label: z.literal('receivedMinusAppliedFlow'),
    disclaimer: z.string(),
  }),
});
export type AnalyticsInventory = z.infer<typeof analyticsInventorySchema>;

export const analyticsNoveltyBucketSchema = z.object({
  noveltyCode: patientOperationalNoveltySchema,
  count: z.number().int().nonnegative(),
  share: analyticsRatioMetricSchema,
});
export type AnalyticsNoveltyBucket = z.infer<typeof analyticsNoveltyBucketSchema>;

export const analyticsOutcomesSchema = z.object({
  notAppliedCount: z.number().int().nonnegative(),
  terminalOperationalResultCount: z.number().int().nonnegative(),
  noShowCount: z.number().int().nonnegative(),
  noShowRate: analyticsRatioMetricSchema,
  distribution: z.array(analyticsNoveltyBucketSchema),
});
export type AnalyticsOutcomes = z.infer<typeof analyticsOutcomesSchema>;

export const analyticsAuditSchema = z.object({
  readyForAudit: z.number().int().nonnegative(),
  inReview: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  approvedApplicationsCount: z.number().int().nonnegative(),
});
export type AnalyticsAudit = z.infer<typeof analyticsAuditSchema>;

export const analyticsEconomicsSchema = z.object({
  compensar: z.object({
    projectedTariffReferenceValue: analyticsMoneyMetricSchema,
    requestedTariffSnapshotValue: analyticsMoneyMetricSchema,
    acceptedTariffSnapshotValue: analyticsMoneyMetricSchema,
  }),
  olp: z.object({
    requestedSupplierValue: analyticsMoneyMetricSchema,
    acceptedSupplierValue: analyticsMoneyMetricSchema,
    dispatchedSupplierValue: analyticsMoneyMetricSchema,
    acceptedReceiptSupplierValue: analyticsMoneyMetricSchema,
    appliedSupplierCost: analyticsMoneyMetricSchema,
  }),
  grossOperationalSpreadReference: analyticsMoneyMetricSchema,
});
export type AnalyticsEconomics = z.infer<typeof analyticsEconomicsSchema>;

export const analyticsFreshnessSchema = z.object({
  definitionsVersion: z.literal('ESP-013'),
  generatedAt: isoDateTimeSchema,
  planningPeriodId: z.string().uuid().nullable(),
  demandLastConsolidatedAt: isoDateTimeSchema.nullable(),
  projectedDemandStale: z.boolean(),
});
export type AnalyticsFreshness = z.infer<typeof analyticsFreshnessSchema>;

export const analyticsFunnelSchema = z.object({
  projectedQuantity: z.number().int().nonnegative(),
  requestedQuantity: z.number().int().nonnegative(),
  acceptedQuantity: z.number().int().nonnegative(),
  dispatchedQuantity: z.number().int().nonnegative(),
  physicallyReceivedQuantity: z.number().int().nonnegative(),
  acceptedIntoInventoryQuantity: z.number().int().nonnegative(),
  appliedQuantity: z.number().int().nonnegative(),
});
export type AnalyticsFunnel = z.infer<typeof analyticsFunnelSchema>;

export const operationalAnalyticsResponseSchema = z.object({
  freshness: analyticsFreshnessSchema,
  demand: analyticsDemandSchema,
  procurement: analyticsProcurementSchema,
  delivery: analyticsDeliverySchema,
  receipt: analyticsReceiptSchema,
  application: analyticsApplicationSchema,
  inventory: analyticsInventorySchema,
  outcomes: analyticsOutcomesSchema,
  audit: analyticsAuditSchema,
  economics: analyticsEconomicsSchema.nullable(),
  funnel: analyticsFunnelSchema,
});
export type OperationalAnalyticsResponse = z.infer<typeof operationalAnalyticsResponseSchema>;

export const analyticsInventoryLotSchema = z.object({
  inventoryLotId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  dispensingPointId: z.string().uuid(),
  dispensingPointCode: z.string(),
  dispensingPointName: z.string(),
  lotNumber: z.string(),
  expirationDate: z.string().date(),
  physicalBalance: z.number().int(),
  usableBalance: z.number().int().nonnegative(),
  expired: z.boolean(),
  upcomingExpiration: z.boolean(),
});
export type AnalyticsInventoryLot = z.infer<typeof analyticsInventoryLotSchema>;

export const analyticsInventoryResponseSchema = z.object({
  freshness: analyticsFreshnessSchema,
  summary: analyticsInventorySchema,
  lots: z.array(analyticsInventoryLotSchema),
});
export type AnalyticsInventoryResponse = z.infer<typeof analyticsInventoryResponseSchema>;

export const analyticsNoveltiesResponseSchema = z.object({
  freshness: analyticsFreshnessSchema,
  outcomes: analyticsOutcomesSchema,
});
export type AnalyticsNoveltiesResponse = z.infer<typeof analyticsNoveltiesResponseSchema>;

export const analyticsEconomicsResponseSchema = z.object({
  freshness: analyticsFreshnessSchema,
  economics: analyticsEconomicsSchema,
});
export type AnalyticsEconomicsResponse = z.infer<typeof analyticsEconomicsResponseSchema>;

export const analyticsDrilldownItemSchema = z.object({
  id: z.string().uuid(),
  kind: analyticsDrilldownKindSchema,
  commercialCode: z.string().nullable(),
  dispensingPointId: z.string().uuid().nullable(),
  quantity: z.number().int().nullable(),
  status: z.string().nullable(),
  reference: z.string().nullable(),
});
export type AnalyticsDrilldownItem = z.infer<typeof analyticsDrilldownItemSchema>;

export const analyticsDrilldownResponseSchema = z.object({
  kind: analyticsDrilldownKindSchema,
  items: z.array(analyticsDrilldownItemSchema),
});
export type AnalyticsDrilldownResponse = z.infer<typeof analyticsDrilldownResponseSchema>;

export const BULK_IMPORT_TYPE_SCHEDULING = 'SCHEDULING' as const;
export const ESP014_SCHEDULING_TEMPLATE_VERSION = 'ESP014_SCHEDULING_V1' as const;
export const BULK_IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const BULK_IMPORT_MAX_ROWS = 5000;
export const BULK_IMPORT_MAX_COLUMNS = 20;
export const BULK_IMPORT_MAX_SHEETS = 5;

export const SCHEDULING_TEMPLATE_REQUIRED_COLUMNS = [
  'AUTORIZACION',
  'DOCUMENTO',
  'COD_COMERCIAL',
  'CANTIDAD',
  'PUNTO',
  'FECHA_PROGRAMADA',
] as const;
export const SCHEDULING_TEMPLATE_OPTIONAL_COLUMNS = ['MANEJO_TARDIO'] as const;

export const bulkImportJobStatusSchema = z.enum([
  'UPLOADED',
  'VALIDATING',
  'READY',
  'INVALID',
  'PROCESSING',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type BulkImportJobStatus = z.infer<typeof bulkImportJobStatusSchema>;

export const bulkImportRowValidationStatusSchema = z.enum([
  'VALID',
  'INVALID',
  'DUPLICATE',
  'CONFLICT',
]);
export type BulkImportRowValidationStatus = z.infer<typeof bulkImportRowValidationStatusSchema>;

export const bulkImportRowExecutionStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
]);
export type BulkImportRowExecutionStatus = z.infer<typeof bulkImportRowExecutionStatusSchema>;

export const bulkImportValidationErrorSchema = z.object({
  code: z.string(),
  rowNumber: z.number().int().positive().nullable(),
  column: z.string().nullable(),
  message: z.string(),
  value: z.string().nullable(),
});
export type BulkImportValidationError = z.infer<typeof bulkImportValidationErrorSchema>;

export const bulkImportJobResponseSchema = z.object({
  id: z.string().uuid(),
  importType: z.literal('SCHEDULING'),
  templateVersion: z.string(),
  status: bulkImportJobStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  fileHash: z.string().length(64),
  duplicateFile: z.boolean(),
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  invalidRows: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  warningRows: z.number().int().nonnegative(),
  createRows: z.number().int().nonnegative(),
  conflictRows: z.number().int().nonnegative(),
  succeededRows: z.number().int().nonnegative(),
  failedRows: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  lastErrorCode: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  validatedAt: isoDateTimeSchema.nullable(),
  confirmedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
});
export type BulkImportJobResponse = z.infer<typeof bulkImportJobResponseSchema>;

export const bulkImportRowResponseSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int().positive(),
  validationStatus: bulkImportRowValidationStatusSchema,
  executionStatus: bulkImportRowExecutionStatusSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  column: z.string().nullable(),
  entityReference: z.string().uuid().nullable(),
  attemptCount: z.number().int().nonnegative(),
  authorizationNumber: z.string().nullable(),
  commercialCode: z.string().nullable(),
  dispensingPointCode: z.string().nullable(),
  scheduledDate: z.string().date().nullable(),
  quantity: z.number().int().nullable(),
});
export type BulkImportRowResponse = z.infer<typeof bulkImportRowResponseSchema>;

export const bulkImportRowListQuerySchema = z.object({
  filter: z.enum(['ALL', 'VALID', 'INVALID', 'EXECUTED', 'FAILED']).optional().default('ALL'),
});
export type BulkImportRowListQuery = z.infer<typeof bulkImportRowListQuerySchema>;

export const reconciliationRunStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
export type ReconciliationRunStatus = z.infer<typeof reconciliationRunStatusSchema>;
export const reconciliationRuleStatusSchema = z.enum([
  'PASS',
  'FAIL',
  'NOT_APPLICABLE',
  'ERROR_EXECUTING_RULE',
]);
export type ReconciliationRuleStatus = z.infer<typeof reconciliationRuleStatusSchema>;
export const reconciliationCategorySchema = z.enum([
  'INTEGRITY',
  'CONSISTENCY',
  'RECONCILIATION',
  'OBSERVATION',
]);
export type ReconciliationCategory = z.infer<typeof reconciliationCategorySchema>;
export const reconciliationSeveritySchema = z.enum(['CRITICAL', 'ERROR', 'WARNING', 'INFO']);
export type ReconciliationSeverity = z.infer<typeof reconciliationSeveritySchema>;
export const reconciliationDomainSchema = z.enum([
  'SCHEDULING',
  'DEMAND',
  'PURCHASE',
  'DELIVERY',
  'RECEIPT',
  'INVENTORY',
  'TRANSFER',
  'APPLICATION',
  'OUTCOME',
  'AUDIT',
  'ANALYTICS',
  'BULK',
  'SCOPE',
  'LEGACY',
]);
export type ReconciliationDomain = z.infer<typeof reconciliationDomainSchema>;

export const createReconciliationRunRequestSchema = z.object({
  planningPeriodId: z.string().uuid().optional(),
  dispensingPointId: z.string().uuid().optional(),
  commercialCode: z.string().min(1).max(255).optional(),
  domains: z.array(reconciliationDomainSchema).min(1).optional(),
  severities: z.array(reconciliationSeveritySchema).min(1).optional(),
});
export type CreateReconciliationRunRequest = z.infer<typeof createReconciliationRunRequestSchema>;

export const reconciliationRunScopeSchema = z.object({
  kind: z.enum(['GLOBAL', 'PLANNING_PERIOD', 'DISPENSING_POINT', 'COMMERCIAL_CODE', 'COMBINED']),
  planningPeriodId: z.string().uuid().nullable(),
  dispensingPointId: z.string().uuid().nullable(),
  commercialCode: z.string().nullable(),
});
export type ReconciliationRunScope = z.infer<typeof reconciliationRunScopeSchema>;

export const reconciliationRuleResultSchema = z.object({
  ruleCode: z.string(),
  status: reconciliationRuleStatusSchema,
  evaluatedCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
  totalDetected: z.number().int().nonnegative(),
  truncated: z.boolean(),
  durationMs: z.number().nonnegative(),
  severity: reconciliationSeveritySchema,
  error: z.string().nullable(),
});
export type ReconciliationRuleResult = z.infer<typeof reconciliationRuleResultSchema>;

export const reconciliationRunResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: reconciliationRunStatusSchema,
  scope: reconciliationRunScopeSchema,
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  startedBy: z.string().uuid().nullable(),
  rulesVersion: z.string(),
  totalRules: z.number().int().nonnegative(),
  passedRules: z.number().int().nonnegative(),
  failedRules: z.number().int().nonnegative(),
  notApplicableRules: z.number().int().nonnegative(),
  criticalFindings: z.number().int().nonnegative(),
  errorFindings: z.number().int().nonnegative(),
  warningFindings: z.number().int().nonnegative(),
  infoFindings: z.number().int().nonnegative(),
  generatedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  ruleResults: z.array(reconciliationRuleResultSchema),
  operationExecutionId: z.string().uuid().nullable().optional(),
});
export type ReconciliationRunResponse = z.infer<typeof reconciliationRunResponseSchema>;

export const reconciliationFindingResponseSchema = z.object({
  id: z.string().uuid(),
  reconciliationRunId: z.string().uuid(),
  ruleCode: z.string(),
  ruleVersion: z.string(),
  category: reconciliationCategorySchema,
  severity: reconciliationSeveritySchema,
  domain: reconciliationDomainSchema,
  entityType: z.string(),
  entityId: z.string().uuid().nullable(),
  relatedEntityType: z.string().nullable(),
  relatedEntityId: z.string().uuid().nullable(),
  dispensingPointId: z.string().uuid().nullable(),
  planningPeriodId: z.string().uuid().nullable(),
  commercialCode: z.string().nullable(),
  message: z.string(),
  evidence: z.record(z.unknown()),
  fingerprint: z.string(),
  truncated: z.boolean(),
  recommendedAction: z.string(),
  detectedAt: isoDateTimeSchema,
  issueId: z.string().uuid(),
});
export type ReconciliationFindingResponse = z.infer<typeof reconciliationFindingResponseSchema>;

export const reconciliationFindingListQuerySchema = z.object({
  severity: reconciliationSeveritySchema.optional(),
  domain: reconciliationDomainSchema.optional(),
  ruleCode: z.string().min(1).optional(),
  dispensingPointId: z.string().uuid().optional(),
  commercialCode: z.string().min(1).optional(),
  planningPeriodId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(200),
});
export type ReconciliationFindingListQuery = z.infer<typeof reconciliationFindingListQuerySchema>;

export const reconciliationIssueStatusSchema = z.enum([
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'ACCEPTED_RISK',
]);
export type ReconciliationIssueStatus = z.infer<typeof reconciliationIssueStatusSchema>;

export const reconciliationIssueEventTypeSchema = z.enum([
  'ISSUE_CREATED',
  'ISSUE_ACKNOWLEDGED',
  'ISSUE_ASSIGNED',
  'ISSUE_UNASSIGNED',
  'ISSUE_RESOLVED',
  'ISSUE_ACCEPTED_RISK',
  'ISSUE_REOPENED',
  'RISK_ACCEPTANCE_INVALIDATED',
  'ISSUE_MANUALLY_REOPENED',
]);
export type ReconciliationIssueEventType = z.infer<typeof reconciliationIssueEventTypeSchema>;

export const reconciliationResolutionCodeSchema = z.enum([
  'DATA_CORRECTED',
  'PROCESS_CORRECTED',
  'RULE_UPDATED',
  'NO_LONGER_APPLICABLE',
  'OTHER',
]);
export type ReconciliationResolutionCode = z.infer<typeof reconciliationResolutionCodeSchema>;

export const reconciliationIssueListQuerySchema = z.object({
  status: reconciliationIssueStatusSchema.optional(),
  severity: reconciliationSeveritySchema.optional(),
  domain: reconciliationDomainSchema.optional(),
  ruleCode: z.string().min(1).optional(),
  assignedTo: z.string().uuid().optional(),
  unassigned: z.coerce.boolean().optional(),
  firstSeenFrom: isoDateTimeSchema.optional(),
  firstSeenTo: isoDateTimeSchema.optional(),
  lastSeenFrom: isoDateTimeSchema.optional(),
  lastSeenTo: isoDateTimeSchema.optional(),
  riskReviewOverdue: z.coerce.boolean().optional(),
  dispensingPointId: z.string().uuid().optional(),
  planningPeriodId: z.string().uuid().optional(),
  commercialCode: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});
export type ReconciliationIssueListQuery = z.infer<typeof reconciliationIssueListQuerySchema>;

const assigneeSummarySchema = z
  .object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
  })
  .nullable();

export const reconciliationIssueResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  ruleCode: z.string(),
  fingerprint: z.string(),
  domain: reconciliationDomainSchema,
  category: reconciliationCategorySchema,
  description: z.string(),
  recommendedAction: z.string(),
  status: reconciliationIssueStatusSchema,
  currentSeverity: reconciliationSeveritySchema,
  maxSeveritySeen: reconciliationSeveritySchema,
  occurrenceCount: z.number().int().positive(),
  firstSeenAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  firstRunId: z.string().uuid(),
  lastRunId: z.string().uuid(),
  lastFindingId: z.string().uuid(),
  firstRuleVersion: z.string(),
  lastRuleVersion: z.string(),
  assignee: assigneeSummarySchema,
  acknowledgedAt: isoDateTimeSchema.nullable(),
  acknowledgedBy: z.string().uuid().nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  resolvedBy: z.string().uuid().nullable(),
  resolutionCode: reconciliationResolutionCodeSchema.nullable(),
  resolutionNote: z.string().nullable(),
  acceptedRiskAt: isoDateTimeSchema.nullable(),
  acceptedRiskBy: z.string().uuid().nullable(),
  acceptedRiskReason: z.string().nullable(),
  acceptedRiskSeverity: reconciliationSeveritySchema.nullable(),
  acceptedRiskRuleVersion: z.string().nullable(),
  riskReviewAt: isoDateTimeSchema.nullable(),
  riskReviewOverdue: z.boolean(),
  daysSinceLastSeen: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ReconciliationIssueResponse = z.infer<typeof reconciliationIssueResponseSchema>;

export const reconciliationIssueEventResponseSchema = z.object({
  id: z.string().uuid(),
  issueId: z.string().uuid(),
  eventType: reconciliationIssueEventTypeSchema,
  fromStatus: reconciliationIssueStatusSchema.nullable(),
  toStatus: reconciliationIssueStatusSchema.nullable(),
  actorUserId: z.string().uuid().nullable(),
  reconciliationRunId: z.string().uuid().nullable(),
  findingId: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: isoDateTimeSchema,
});
export type ReconciliationIssueEventResponse = z.infer<
  typeof reconciliationIssueEventResponseSchema
>;

export const reconciliationIssueCommentResponseSchema = z.object({
  id: z.string().uuid(),
  issueId: z.string().uuid(),
  authorUserId: z.string().uuid(),
  authorUsername: z.string(),
  body: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ReconciliationIssueCommentResponse = z.infer<
  typeof reconciliationIssueCommentResponseSchema
>;

export const expectedVersionSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const acknowledgeReconciliationIssueRequestSchema = expectedVersionSchema;
export type AcknowledgeReconciliationIssueRequest = z.infer<
  typeof acknowledgeReconciliationIssueRequestSchema
>;

export const assignReconciliationIssueRequestSchema = expectedVersionSchema.extend({
  assignedToUserId: z.string().uuid(),
});
export type AssignReconciliationIssueRequest = z.infer<
  typeof assignReconciliationIssueRequestSchema
>;

export const unassignReconciliationIssueRequestSchema = expectedVersionSchema;
export type UnassignReconciliationIssueRequest = z.infer<
  typeof unassignReconciliationIssueRequestSchema
>;

export const resolveReconciliationIssueRequestSchema = expectedVersionSchema.extend({
  resolutionCode: reconciliationResolutionCodeSchema,
  resolutionNote: z.string().trim().min(1).max(2000),
});
export type ResolveReconciliationIssueRequest = z.infer<
  typeof resolveReconciliationIssueRequestSchema
>;

export const acceptReconciliationIssueRiskRequestSchema = expectedVersionSchema.extend({
  acceptedRiskReason: z.string().trim().min(1).max(2000),
  riskReviewAt: isoDateTimeSchema.optional(),
});
export type AcceptReconciliationIssueRiskRequest = z.infer<
  typeof acceptReconciliationIssueRiskRequestSchema
>;

export const reopenReconciliationIssueRequestSchema = expectedVersionSchema;
export type ReopenReconciliationIssueRequest = z.infer<
  typeof reopenReconciliationIssueRequestSchema
>;

export const createReconciliationIssueCommentRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type CreateReconciliationIssueCommentRequest = z.infer<
  typeof createReconciliationIssueCommentRequestSchema
>;

export const reconciliationRuleCatalogItemSchema = z.object({
  ruleCode: z.string(),
  version: z.string(),
  domain: reconciliationDomainSchema,
  category: reconciliationCategorySchema,
  defaultSeverity: reconciliationSeveritySchema,
  description: z.string(),
  applicability: z.string(),
  sourceTables: z.array(z.string()),
  expectedInvariant: z.string(),
  findingEvidence: z.string(),
  recommendedAction: z.string(),
  detectionMode: z.string(),
  ownedBy: z.string().optional(),
  executable: z.boolean(),
});
export type ReconciliationRuleCatalogItem = z.infer<typeof reconciliationRuleCatalogItemSchema>;

export const reconciliationCadenceSchema = z.enum(['DAILY', 'WEEKLY', 'MANUAL']);
export type ReconciliationCadence = z.infer<typeof reconciliationCadenceSchema>;

export const reconciliationTriggerTypeSchema = z.enum(['MANUAL', 'SCHEDULED', 'RETRY']);
export type ReconciliationTriggerType = z.infer<typeof reconciliationTriggerTypeSchema>;

export const reconciliationExecutionStatusSchema = z.enum([
  'PENDING',
  'CLAIMED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'SKIPPED',
]);
export type ReconciliationExecutionStatus = z.infer<typeof reconciliationExecutionStatusSchema>;

export const reconciliationNotificationTypeSchema = z.enum([
  'RECONCILIATION_CRITICAL',
  'RECONCILIATION_ERROR',
  'RECONCILIATION_WARNING',
  'RECONCILIATION_TECHNICAL_FAILURE',
  'RECONCILIATION_RECOVERY',
  'RISK_REVIEW_OVERDUE',
]);
export type ReconciliationNotificationType = z.infer<typeof reconciliationNotificationTypeSchema>;

export const reconciliationNotificationStatusSchema = z.enum([
  'PENDING',
  'SENT',
  'FAILED',
  'SUPPRESSED',
]);
export type ReconciliationNotificationStatus = z.infer<
  typeof reconciliationNotificationStatusSchema
>;

export const reconciliationSeverityAlertThresholdSchema = z.enum([
  'CRITICAL',
  'ERROR',
  'WARNING',
  'NONE',
]);
export type ReconciliationSeverityAlertThreshold = z.infer<
  typeof reconciliationSeverityAlertThresholdSchema
>;

export const reconciliationNotificationChannelSchema = z.enum(['IN_APP']);
export type ReconciliationNotificationChannel = z.infer<
  typeof reconciliationNotificationChannelSchema
>;

export const reconciliationOperationPolicyResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  enabled: z.boolean(),
  cadence: reconciliationCadenceSchema,
  timezone: z.string(),
  localTime: z.string().nullable(),
  weekday: z.number().int().min(1).max(7).nullable(),
  domains: z.array(reconciliationDomainSchema).nullable(),
  planningPeriodScope: z.string().nullable(),
  severityAlertThreshold: reconciliationSeverityAlertThresholdSchema,
  notifyOnRecovery: z.boolean(),
  notifyOnTechnicalFailure: z.boolean(),
  nextRunAt: isoDateTimeSchema.nullable(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ReconciliationOperationPolicyResponse = z.infer<
  typeof reconciliationOperationPolicyResponseSchema
>;

export const upsertReconciliationOperationPolicyRequestSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  enabled: z.boolean().default(false),
  cadence: reconciliationCadenceSchema,
  timezone: z.string().default('America/Bogota'),
  localTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  domains: z.array(reconciliationDomainSchema).nullable().optional(),
  planningPeriodScope: z.string().nullable().optional(),
  severityAlertThreshold: reconciliationSeverityAlertThresholdSchema.default('ERROR'),
  notifyOnRecovery: z.boolean().default(true),
  notifyOnTechnicalFailure: z.boolean().default(true),
});
export type UpsertReconciliationOperationPolicyRequest = z.infer<
  typeof upsertReconciliationOperationPolicyRequestSchema
>;

export const reconciliationOperationExecutionResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  policyId: z.string().uuid().nullable(),
  triggerType: reconciliationTriggerTypeSchema,
  scheduledFor: isoDateTimeSchema.nullable(),
  claimedAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  status: reconciliationExecutionStatusSchema,
  reconciliationRunId: z.string().uuid().nullable(),
  attemptCount: z.number().int().nonnegative(),
  claimToken: z.string().nullable(),
  claimGeneration: z.number().int().nonnegative(),
  leaseExpiresAt: isoDateTimeSchema.nullable(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  missedOccurrencesCount: z.number().int().nonnegative(),
  skipReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  runHealth: z.enum(['HEALTHY', 'UNHEALTHY']).nullable().optional(),
  criticalFindings: z.number().int().nonnegative().nullable().optional(),
  errorFindings: z.number().int().nonnegative().nullable().optional(),
  warningFindings: z.number().int().nonnegative().nullable().optional(),
});
export type ReconciliationOperationExecutionResponse = z.infer<
  typeof reconciliationOperationExecutionResponseSchema
>;

export const reconciliationNotificationResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  executionId: z.string().uuid().nullable(),
  reconciliationRunId: z.string().uuid().nullable(),
  notificationType: reconciliationNotificationTypeSchema,
  severity: reconciliationSeveritySchema,
  dedupKey: z.string(),
  status: reconciliationNotificationStatusSchema,
  channel: reconciliationNotificationChannelSchema,
  payload: z.record(z.unknown()),
  attemptCount: z.number().int().nonnegative(),
  readAt: isoDateTimeSchema.nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  lastErrorCode: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ReconciliationNotificationResponse = z.infer<
  typeof reconciliationNotificationResponseSchema
>;

export const listReconciliationOperationExecutionsQuerySchema = z.object({
  status: reconciliationExecutionStatusSchema.optional(),
  triggerType: reconciliationTriggerTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListReconciliationOperationExecutionsQuery = z.infer<
  typeof listReconciliationOperationExecutionsQuerySchema
>;

export const listReconciliationNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  status: reconciliationNotificationStatusSchema.optional(),
  severity: reconciliationSeveritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListReconciliationNotificationsQuery = z.infer<
  typeof listReconciliationNotificationsQuerySchema
>;

export const triggerManualOperationExecutionRequestSchema = z.object({
  domains: z.array(reconciliationDomainSchema).min(1).optional(),
  planningPeriodId: z.string().uuid().optional(),
  dispensingPointId: z.string().uuid().optional(),
  commercialCode: z.string().min(1).max(255).optional(),
});
export type TriggerManualOperationExecutionRequest = z.infer<
  typeof triggerManualOperationExecutionRequestSchema
>;
