import { getAccessPermissionDefinition, type AccessActorBoundary } from '@authorization/contracts';

export const ACTOR_BOUNDARY_VIOLATION = 'ACTOR_BOUNDARY_VIOLATION' as const;

export class ActorBoundaryPolicyError extends Error {
  readonly code = ACTOR_BOUNDARY_VIOLATION;

  constructor(
    readonly organizationCode: string,
    readonly roleCode: string,
    readonly permissionCode: string,
  ) {
    super(`Role ${roleCode} in organization ${organizationCode} cannot use ${permissionCode}`);
    this.name = 'ActorBoundaryPolicyError';
  }
}

function isKnownOrganization(organizationCode: string): boolean {
  return ['MTD', 'MEDICARTE', 'OLP', 'COMPENSAR'].includes(organizationCode);
}

function isBoundaryAllowed(
  boundary: AccessActorBoundary,
  organizationCode: string,
  roleCode: string,
): boolean {
  switch (boundary) {
    case 'SYSTEM':
    case 'MTD_ONLY':
      return organizationCode === 'MTD';
    case 'MEDICARTE_POINT':
      // MTD has global point scope and is the only cross-actor administrative
      // exception. MEDICARTE operators still require explicit point grants.
      return (
        (organizationCode === 'MTD' && roleCode === 'MTD_ADMIN') ||
        (organizationCode === 'MEDICARTE' && roleCode === 'MEDICARTE_OPERATOR')
      );
    case 'OLP_ONLY':
      return organizationCode === 'OLP' && roleCode === 'OLP_OPERATOR';
    case 'COMPENSAR_ONLY':
      return organizationCode === 'COMPENSAR' && roleCode === 'COMPENSAR_VIEWER';
    case 'ACTOR_PROJECTION':
    case 'ORGANIZATION':
      return isKnownOrganization(organizationCode);
  }
}

export function isPermissionAllowedForActor(
  organizationCode: string,
  roleCode: string,
  permissionCode: string,
): boolean {
  const permission = getAccessPermissionDefinition(permissionCode);
  if (!permission) return false;
  return isBoundaryAllowed(permission.actorBoundary, organizationCode, roleCode);
}

export function assertPermissionAllowedForActor(
  organizationCode: string,
  roleCode: string,
  permissionCode: string,
): void {
  if (!isPermissionAllowedForActor(organizationCode, roleCode, permissionCode)) {
    throw new ActorBoundaryPolicyError(organizationCode, roleCode, permissionCode);
  }
}
