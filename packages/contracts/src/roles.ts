import { z } from 'zod';

export const roleSummarySchema = z.object({
  code: z.string(),
  name: z.string(),
  label: z.string(),
  active: z.boolean(),
  isCustom: z.boolean(),
  isSystemAdmin: z.boolean(),
  isSystemManaged: z.boolean(),
  isProtected: z.boolean(),
  allowedOrganizationCodes: z.array(z.string()),
  userCount: z.number().int().nonnegative(),
  permissionCount: z.number().int().nonnegative(),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const roleAccessActionSchema = z.object({
  code: z.string(),
  label: z.string(),
  permissionCode: z.string(),
  lifecycle: z.enum(['ACTIVE', 'LEGACY', 'ORPHAN', 'RETIRED']),
  actorBoundary: z.string(),
  configurable: z.boolean(),
  structural: z.boolean(),
  systemAllowed: z.boolean(),
  enabled: z.boolean(),
  editable: z.boolean(),
});
export type RoleAccessAction = z.infer<typeof roleAccessActionSchema>;

export const roleAccessModuleSchema = z.object({
  code: z.string(),
  label: z.string(),
  description: z.string(),
  route: z.string(),
  section: z.string(),
  icon: z.string(),
  displayOrder: z.number().int(),
  actions: z.array(roleAccessActionSchema),
});
export type RoleAccessModule = z.infer<typeof roleAccessModuleSchema>;

export const rolesResponseSchema = z.object({
  items: z.array(roleSummarySchema),
});
export type RolesResponse = z.infer<typeof rolesResponseSchema>;

const organizationCodesSchema = z
  .array(z.enum(['MTD', 'MEDICARTE', 'OLP', 'COMPENSAR']))
  .min(1)
  .max(4)
  .refine((codes) => new Set(codes).size === codes.length, {
    message: 'Organization codes must be unique',
  });

export const createRoleRequestSchema = z.object({
  name: z.string().trim().min(2).max(160),
  organizationCodes: organizationCodesSchema,
});
export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;

export const updateRoleRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    active: z.boolean().optional(),
    organizationCodes: organizationCodesSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.active !== undefined, {
    message: 'At least one role field is required',
  });
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

export const roleAccessResponseSchema = z.object({
  role: roleSummarySchema,
  fingerprint: z.string().length(64),
  modules: z.array(roleAccessModuleSchema),
});
export type RoleAccessResponse = z.infer<typeof roleAccessResponseSchema>;

export const updateRoleAccessRequestSchema = z.object({
  expectedFingerprint: z.string().length(64),
  permissionCodes: z.array(z.string().min(1).max(120)).max(200),
});
export type UpdateRoleAccessRequest = z.infer<typeof updateRoleAccessRequestSchema>;
