import type { MeResponse } from '@authorization/contracts';
import { ForbiddenException } from '@nestjs/common';
import { pointAccessKindFor } from '../common/request-scope';

export type PatientMasterScope = Readonly<{
  organizationId: string;
  organizationCode: 'MTD' | 'MEDICARTE';
  userId: string;
  pointAccessKind: 'global' | 'explicit' | 'unrestricted';
  dispensingPointId: string | null;
}>;

export function resolvePatientMasterScope(
  profile: MeResponse,
  organizationId: string,
  userId: string,
  requestedPointId?: string,
): PatientMasterScope {
  const organization = profile.organizations.find((item) => item.id === organizationId);
  if (!organization || !organization.permissions.includes('patient_master.read')) {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }

  if (organization.code === 'MTD') {
    return {
      organizationId,
      organizationCode: 'MTD',
      userId,
      pointAccessKind: 'global',
      dispensingPointId: requestedPointId ?? null,
    };
  }

  if (organization.code !== 'MEDICARTE') {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }

  const pointAccessKind = pointAccessKindFor(organization.code, organization.roles);
  if (
    pointAccessKind !== 'explicit' ||
    !requestedPointId ||
    organization.pointAccess.kind !== 'explicit' ||
    !organization.pointAccess.accessiblePointIds.includes(requestedPointId)
  ) {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_POINT_SCOPE_REQUIRED' });
  }

  return {
    organizationId,
    organizationCode: 'MEDICARTE',
    userId,
    pointAccessKind,
    dispensingPointId: requestedPointId,
  };
}

export function assertPatientReconciliationReadAllowed(
  profile: MeResponse,
  organizationId: string,
): void {
  const organization = profile.organizations.find((item) => item.id === organizationId);
  if (
    organization?.code !== 'MTD' ||
    !organization.permissions.includes('patient_reconciliation.read')
  ) {
    throw new ForbiddenException({ code: 'PATIENT_RECONCILIATION_ACCESS_DENIED' });
  }
}
