import { z } from 'zod';

export const moderatorFeeCollectionStatusSchema = z.enum([
  'NOT_RECORDED',
  'COLLECTED',
  'NOT_COLLECTED',
]);

export type ModeratorFeeCollectionStatus = z.infer<
  typeof moderatorFeeCollectionStatusSchema
>;

const positiveCopAmountSchema = z.string()
  .regex(
    /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/,
    'Valor COP inválido',
  )
  .refine(
    value => Number(value) > 0,
    'El recaudo debe ser mayor que cero',
  );

const isoDateTime = z.string().datetime({
  offset: true,
});

const base = z.object({
  idempotencyKey: z.string().uuid(),

  expectedVersion: z.number()
    .int()
    .nonnegative(),

  observation: z.string()
    .trim()
    .max(1000)
    .nullable()
    .optional(),

  reference: z.string()
    .trim()
    .max(255)
    .nullable()
    .optional(),

  professionalDocument: z.string()
    .trim()
    .max(50)
    .nullable()
    .optional(),
});

export const registerModeratorFeeRequestSchema =
  z.discriminatedUnion('status', [
    base.extend({
      status: z.literal('COLLECTED'),
      amountCop: positiveCopAmountSchema.optional(),
      collectedAt: isoDateTime,
    }).strict(),

    base.extend({
      status: z.literal('NOT_COLLECTED'),
      amountCop: z.null().optional(),
      collectedAt: z.null().optional(),
    }).strict(),
  ]);

export type RegisterModeratorFeeRequest = z.infer<
  typeof registerModeratorFeeRequestSchema
>;

export const moderatorFeeEventSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),

  status: z.enum([
    'COLLECTED',
    'NOT_COLLECTED',
  ]),

  amountCop: z.string().nullable(),
  collectedAt: isoDateTime.nullable(),

  observation: z.string().nullable(),
  reference: z.string().nullable(),

  registeredBy: z.string().uuid(),
  registeredAt: isoDateTime,
});

export type ModeratorFeeEvent = z.infer<
  typeof moderatorFeeEventSchema
>;

export const moderatorFeeResponseSchema = z.object({
  authorizationItemId: z.string().uuid(),

  expectedAmountCop: z.string().nullable(),

  status: moderatorFeeCollectionStatusSchema,

  amountCop: z.string().nullable(),

  collectedAt: isoDateTime.nullable(),

  version: z.number().int().nonnegative(),

  lastRegisteredAt: isoDateTime.nullable(),

  history: z.array(moderatorFeeEventSchema),
});

export type ModeratorFeeResponse = z.infer<
  typeof moderatorFeeResponseSchema
>;

export const moderatorFeeInvoiceUrlResponseSchema = z.object({
  invoiceUrl: z.string().nullable(),
});

export type ModeratorFeeInvoiceUrlResponse = z.infer<
  typeof moderatorFeeInvoiceUrlResponseSchema
>;
