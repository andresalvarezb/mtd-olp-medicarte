import {
  ACCESS_SYSTEM_ALLOWED_PERMISSION_CODES,
  isSystemAllowedPermission,
} from '@authorization/contracts';

export const MTD_ADMIN_ROLE_CODE = 'MTD_ADMIN' as const;

export type AccessRoleSnapshot = Readonly<{
  code: string;
  isSystemAdmin: boolean;
}>;

export function isAllowAllAdministrator(
  organizationCode: string,
  roles: readonly AccessRoleSnapshot[],
): boolean {
  return (
    organizationCode === 'MTD' &&
    roles.some((role) => role.code === MTD_ADMIN_ROLE_CODE && role.isSystemAdmin)
  );
}

export function effectivePermissionCodes(input: {
  organizationCode: string;
  roles: readonly AccessRoleSnapshot[];
  grantedPermissionCodes: readonly string[];
}): readonly string[] {
  const permissions = new Set(input.grantedPermissionCodes);
  if (isAllowAllAdministrator(input.organizationCode, input.roles)) {
    for (const permission of ACCESS_SYSTEM_ALLOWED_PERMISSION_CODES) {
      permissions.add(permission);
    }
  }
  return [...permissions];
}

export function isPermissionGrantedByAllowAll(
  organizationCode: string,
  roles: readonly AccessRoleSnapshot[],
  permissionCode: string,
): boolean {
  return (
    isAllowAllAdministrator(organizationCode, roles) && isSystemAllowedPermission(permissionCode)
  );
}
