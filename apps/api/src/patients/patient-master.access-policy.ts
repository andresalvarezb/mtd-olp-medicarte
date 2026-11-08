import type { MeResponse } from '@authorization/contracts';
import { ForbiddenException } from '@nestjs/common';

export type PatientMasterScope = Readonly<{
  organizationId: string;
  organizationCode: 'MTD';
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

  if (organization.code !== 'MTD') {
    throw new ForbiddenException({ code: 'PATIENT_MASTER_ACCESS_DENIED' });
  }
  return {
    organizationId,
    organizationCode: 'MTD',
    userId,
    pointAccessKind: 'global',
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
