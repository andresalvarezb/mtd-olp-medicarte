import { BadRequestException } from '@nestjs/common';
import type { MeResponse } from '@authorization/contracts';
import type { AuthenticatedRequest } from '../types';

export type Scope = Readonly<{
  organizationId: string;
  organizationCode: string;
  userId: string;
  correlationId: string;
  readSensitive: boolean;
}>;

export function scopeFromProfile(profile: MeResponse, organizationId: string, request: AuthenticatedRequest): Scope {
  const organization = profile.organizations.find((candidate) => candidate.id === organizationId);
  if (!organization) throw new BadRequestException({ code: 'ORGANIZATION_REQUIRED', message: 'Organization is not available for this user' });
  return {
    organizationId,
    organizationCode: organization.code,
    userId: profile.id,
    correlationId: request.correlationId,
    readSensitive: organization.permissions.includes('authorizations.read_sensitive'),
  };
}
