import { z } from 'zod';

export const correlationIdSchema = z.string().uuid();
export const idempotencyKeySchema = z.string().min(8).max(200);

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
