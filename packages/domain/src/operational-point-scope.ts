export const POINT_ACCESS_DENIED = 'POINT_ACCESS_DENIED' as const;

export type PointAccessKind = 'global' | 'explicit' | 'unrestricted';

export type PointAccessScope = Readonly<
  { kind: 'global' } | { kind: 'unrestricted' } | { kind: 'explicit'; pointIds: readonly string[] }
>;

export class PointAccessDeniedError extends Error {
  readonly code = POINT_ACCESS_DENIED;
  constructor(message = 'The dispensing point is outside the actor data scope') {
    super(message);
    this.name = 'PointAccessDeniedError';
  }
}

export function isGlobalPointScope(scope: PointAccessScope): boolean {
  return scope.kind === 'global';
}

export function isExplicitPointScope(scope: PointAccessScope): boolean {
  return scope.kind === 'explicit';
}

export function canAccessPoint(scope: PointAccessScope, pointId: string): boolean {
  if (scope.kind === 'global' || scope.kind === 'unrestricted') return true;
  return scope.pointIds.includes(pointId);
}

export function canAccessPoints(scope: PointAccessScope, pointIds: readonly string[]): boolean {
  return pointIds.every((pointId) => canAccessPoint(scope, pointId));
}

export function requiresPointGrant(organizationCode: string, roles: readonly string[]): boolean {
  return organizationCode === 'MEDICARTE' && roles.includes('MEDICARTE_OPERATOR');
}

export function isPointScopeGlobalActor(
  organizationCode: string,
  roles: readonly string[],
): boolean {
  return (
    organizationCode === 'MTD' &&
    (roles.includes('MTD_ADMIN') ||
      roles.includes('MTD_OPERATOR') ||
      roles.includes('MTD_GENERAL') ||
      roles.includes('MTD_AUDITORIA') ||
      roles.includes('READ_ONLY'))
  );
}

export function isPointScopeEligibleTarget(roles: readonly string[]): boolean {
  return roles.includes('MEDICARTE_OPERATOR');
}
