import { z } from 'zod';

export const automaticReconciliationOptionsSchema = z.object({
  dryRun: z.boolean().default(true),
  limit: z.number().int().min(1).max(5).default(1),
  cursor: z.string().trim().min(1).max(255).optional(),
  commercialCodes: z.array(z.string().trim().min(1).max(255)).min(1).max(25).optional(),
  dispensingPointIds: z.array(z.string().uuid()).min(1).max(25).optional(),
}).strict();

export const automaticReconciliationRequestSchema = automaticReconciliationOptionsSchema
  .extend({ confirm: z.literal('ASSIGN_AVAILABLE_STOCK').optional() })
  .superRefine((value, context) => {
    if (!value.dryRun && value.confirm !== 'ASSIGN_AVAILABLE_STOCK') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirm'],
        message: 'Execution requires confirm=ASSIGN_AVAILABLE_STOCK',
      });
    }
  });

export type AutomaticReconciliationOptions = z.infer<typeof automaticReconciliationOptionsSchema>;
export type AutomaticReconciliationInput = z.input<typeof automaticReconciliationOptionsSchema>;

export type AutomaticAssignmentOutcome = Readonly<{
  batchId?: string;
  assignedQuantity: number;
  assignedAuthorizationKeys: readonly string[];
  unmatchedStock: readonly Readonly<{
    commercialCode: string;
    dispensingPointId: string;
    quantity: number;
    reason: string;
  }>[];
  dryRun?: boolean;
  plannedQuantity?: number;
  plannedAuthorizationKeys?: readonly string[];
  requests?: readonly Readonly<{
    authorizationKey: string;
    purchaseOrderCode: string;
    quantity: number;
  }>[];
}>;

export type AutomaticReconciliationProductResult = Readonly<{
  status: 'BUSY' | 'PREVIEWED' | 'ASSIGNED' | 'UNCHANGED';
  result: AutomaticAssignmentOutcome;
}>;

export const automaticReconciliationActorSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  correlationId: z.string().uuid(),
});
export type AutomaticReconciliationActor = z.infer<typeof automaticReconciliationActorSchema>;

const scheduleSchema = z.object({
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  dryRun: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  intervalMs: z.coerce.number().int().min(10_000).max(3_600_000).default(60_000),
  limit: z.coerce.number().int().min(1).max(5).default(1),
});

export function parseAutomaticReconciliationSchedule(env: NodeJS.ProcessEnv) {
  const enabled = z.enum(['true', 'false']).parse(env.INVENTORY_AUTO_RECONCILE_ENABLED ?? 'false');
  if (enabled === 'false') return undefined;
  return scheduleSchema.parse({
    userId: env.INVENTORY_AUTO_RECONCILE_ACTOR_USER_ID,
    organizationId: env.INVENTORY_AUTO_RECONCILE_ORGANIZATION_ID,
    dryRun: env.INVENTORY_AUTO_RECONCILE_DRY_RUN,
    intervalMs: env.INVENTORY_AUTO_RECONCILE_INTERVAL_MS,
    limit: env.INVENTORY_AUTO_RECONCILE_BATCH_SIZE,
  });
}

/** Do not log driver messages: they can contain SQL parameters or patient data. */
export function automaticReconciliationErrorCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
    const detail = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof detail.code === 'string' && /^[0-9A-Z]{5}$/.test(detail.code)) return detail.code;
    if (typeof detail.message === 'string' && /^INVENTORY_[A-Z0-9_]+$/.test(detail.message)) {
      return detail.message;
    }
    current = detail.cause;
  }
  return 'AUTO_RECONCILIATION_PRODUCT_FAILED';
}
