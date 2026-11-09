import type { MeResponse } from '@authorization/contracts';
import { ForbiddenException } from '@nestjs/common';

export type PatientMasterScope = Readonly<{
  organizationId: string;
  organizationCode: 'MTD';
  userId: string;
  pointAccessKind: 'global' | 'explicit' | 'unrestricted';
  accessiblePointIds: readonly string[];
  dispensingPointId: string | null;
}>;

export function resolvePatientMasterScope(
  profile: MeResponse,
  organizationId: string,
  userId: string,
  requestedPointId?: string,
  requiredPermission: 'patient_master.read' | 'patient_reconciliation.read' = 'patient_master.read',
): PatientMasterScope {
  const organization = profile.organizations.find((item) => item.id === organizationId);
  if (!organization || !organization.permissions.includes(requiredPermission)) {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }

  if (organization.code !== 'MTD') {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }
  const pointAccess = organization.pointAccess;
  if (pointAccess.kind === 'unrestricted') {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }
  const accessiblePointIds = pointAccess.kind === 'explicit'
    ? [...new Set(pointAccess.accessiblePointIds)]
    : [];
  if (pointAccess.kind === 'explicit' && accessiblePointIds.length === 0) {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }
  if (requestedPointId && pointAccess.kind === 'explicit' && !accessiblePointIds.includes(requestedPointId)) {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }
  return {
    organizationId,
    organizationCode: 'MTD',
    userId,
    pointAccessKind: pointAccess.kind,
    accessiblePointIds,
    dispensingPointId: requestedPointId ?? null,
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
