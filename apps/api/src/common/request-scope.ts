import { BadRequestException } from '@nestjs/common';
import type { MeResponse, PointAccessKind } from '@authorization/contracts';
import { isPointScopeGlobalActor, requiresPointGrant } from '@authorization/domain';
import type { AuthenticatedRequest } from '../types';

export type Scope = Readonly<{
  organizationId: string;
  organizationCode: string;
  userId: string;
  correlationId: string;
  readSensitive: boolean;
  isFoundationAdmin: boolean;
  canCrossOrganizationOperationalExport: boolean;
  pointAccessKind: PointAccessKind;
}>;

export function pointAccessKindFor(
  organizationCode: string,
  roles: readonly string[],
): PointAccessKind {
  if (isPointScopeGlobalActor(organizationCode, roles)) return 'global';
  if (requiresPointGrant(organizationCode, roles)) return 'explicit';
  return 'unrestricted';
}

export function scopeFromProfile(
  profile: MeResponse,
  organizationId: string,
  request: AuthenticatedRequest,
): Scope {
  const organization = profile.organizations.find((candidate) => candidate.id === organizationId);
  if (!organization)
    throw new BadRequestException({
      code: 'ORGANIZATION_REQUIRED',
      message: 'Organization is not available for this user',
    });
  return {
    organizationId,
    organizationCode: organization.code,
    userId: profile.id,
    correlationId: request.correlationId,
    readSensitive: organization.permissions.includes('authorizations.read_sensitive'),
    isFoundationAdmin: organization.roles.includes('MTD_ADMIN'),
    canCrossOrganizationOperationalExport:
      organization.code === 'MTD' &&
      organization.permissions.includes('operational_exports.create'),
    pointAccessKind: pointAccessKindFor(organization.code, organization.roles),
  };
}
