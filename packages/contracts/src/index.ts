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

export const patientScheduleStatusSchema = z.enum(['SCHEDULED', 'CANCELLED']);
export type PatientScheduleStatus = z.infer<typeof patientScheduleStatusSchema>;

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

export const patientScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  authorizationItemId: z.string().uuid(),
  planningPeriodId: z.string().uuid(),
  dispensingPointId: z.string().uuid(),
  commercialCode: commercialCodeSchema,
  scheduledDate: z.string().date(),
  quantity: z.number().int().positive(),
  status: patientScheduleStatusSchema,
  revision: z.number().int().positive(),
});
export type PatientScheduleResponse = z.infer<typeof patientScheduleResponseSchema>;
