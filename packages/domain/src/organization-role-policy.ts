export const ORGANIZATION_ROLE_MATRIX = Object.freeze({
  MTD: ['MTD_ADMIN', 'MTD_OPERATOR', 'MTD_GENERAL', 'MTD_AUDITORIA', 'READ_ONLY'],
  MEDICARTE: ['MEDICARTE_OPERATOR', 'READ_ONLY'],
  OLP: ['OLP_OPERATOR', 'READ_ONLY'],
  COMPENSAR: ['COMPENSAR_VIEWER', 'READ_ONLY'],
} as const);

export type OrganizationCode = keyof typeof ORGANIZATION_ROLE_MATRIX;

export const PREDEFINED_ROLE_CODES = [
  'MTD_ADMIN',
  'MTD_OPERATOR',
  'MTD_GENERAL',
  'MTD_AUDITORIA',
  'READ_ONLY',
  'MEDICARTE_OPERATOR',
  'OLP_OPERATOR',
  'COMPENSAR_VIEWER',
] as const;

export const PROTECTED_ROLE_CODES = ['MTD_ADMIN'] as const;
export const CUSTOM_ROLE_PREFIX = 'CUSTOM_';

export type PredefinedRoleCode = (typeof PREDEFINED_ROLE_CODES)[number];

export const ORGANIZATION_ROLE_NOT_ALLOWED = 'ORGANIZATION_ROLE_NOT_ALLOWED' as const;

export class OrganizationRolePolicyError extends Error {
  readonly code = ORGANIZATION_ROLE_NOT_ALLOWED;

  constructor(
    readonly organizationCode: string,
    readonly roleCode: string,
  ) {
    super(`Role ${roleCode} cannot be assigned to organization ${organizationCode}`);
    this.name = 'OrganizationRolePolicyError';
  }
}

export type RoleAssignmentCandidate = Readonly<{
  organizationCode: string;
  roleCode: string;
  active?: boolean;
}>;

export function allowedRolesForOrganization(organizationCode: string): readonly string[] {
  return ORGANIZATION_ROLE_MATRIX[organizationCode as OrganizationCode] ?? [];
}

export function isRoleAllowedForOrganization(organizationCode: string, roleCode: string): boolean {
  return allowedRolesForOrganization(organizationCode).includes(roleCode);
}

export function assertRoleAllowedForOrganization(organizationCode: string, roleCode: string): void {
  if (!isRoleAllowedForOrganization(organizationCode, roleCode)) {
    throw new OrganizationRolePolicyError(organizationCode, roleCode);
  }
}

export function isPredefinedRole(roleCode: string): roleCode is PredefinedRoleCode {
  return (PREDEFINED_ROLE_CODES as readonly string[]).includes(roleCode);
}

export function isCustomRole(roleCode: string): boolean {
  return roleCode.startsWith(CUSTOM_ROLE_PREFIX);
}

export function isProtectedRole(roleCode: string): boolean {
  return (PROTECTED_ROLE_CODES as readonly string[]).includes(roleCode);
}

/**
 * Historical assignments are reported, not mutated. Callers can use this
 * result while applying a forward migration or presenting a dry-run.
 */
export function findInvalidRoleAssignments(
  assignments: readonly RoleAssignmentCandidate[],
): readonly RoleAssignmentCandidate[] {
  return assignments.filter(
    (assignment) =>
      assignment.active !== false &&
      !isRoleAllowedForOrganization(assignment.organizationCode, assignment.roleCode),
  );
}
