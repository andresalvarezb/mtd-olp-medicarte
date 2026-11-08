import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@authorization/contracts';
import { ForbiddenException } from '@nestjs/common';
import {
  assertPatientReconciliationReadAllowed,
  resolvePatientMasterScope,
} from './patient-master.access-policy';

const MTD_ORG = '10000000-0000-4000-8000-000000000001';
const MEDICARTE_ORG = '10000000-0000-4000-8000-000000000004';
const POINT_A = '20000000-0000-4000-8000-000000000001';
const POINT_B = '20000000-0000-4000-8000-000000000002';
const USER = '30000000-0000-4000-8000-000000000001';

function profile(
  organization: Partial<MeResponse['organizations'][number]> &
    Pick<MeResponse['organizations'][number], 'id' | 'code'>,
): MeResponse {
  return {
    id: USER,
    username: 'synthetic-user',
    displayName: 'Synthetic User',
    mustChangePassword: false,
    organizations: [
      {
        name: 'Synthetic organization',
        roles: [],
        isSystemAdmin: false,
        permissions: [],
        pointAccess: { kind: 'unrestricted', accessiblePointIds: [] },
        ...organization,
      },
    ],
  };
}

describe('patient master access policy (synthetic grants)', () => {
  it('allows an explicitly granted MTD master read without point restriction', () => {
    const actor = profile({
      id: MTD_ORG,
      code: 'MTD',
      roles: ['MTD_ADMIN'],
      permissions: ['patient_master.read'],
      pointAccess: { kind: 'global', accessiblePointIds: [] },
    });

    expect(resolvePatientMasterScope(actor, MTD_ORG, USER)).toMatchObject({
      organizationCode: 'MTD',
      dispensingPointId: null,
    });
  });

  it('allows only the requested Medicarte point present in explicit grants', () => {
    const actor = profile({
      id: MEDICARTE_ORG,
      code: 'MEDICARTE',
      roles: ['MEDICARTE_OPERATOR'],
      permissions: ['patient_master.read'],
      pointAccess: { kind: 'explicit', accessiblePointIds: [POINT_A] },
    });

    expect(resolvePatientMasterScope(actor, MEDICARTE_ORG, USER, POINT_A)).toMatchObject({
      organizationCode: 'MEDICARTE',
      dispensingPointId: POINT_A,
    });
    expect(() => resolvePatientMasterScope(actor, MEDICARTE_ORG, USER, POINT_B)).toThrow(
      ForbiddenException,
    );
  });

  it('denies OLP even if a malformed synthetic profile contains the read permission', () => {
    const actor = profile({
      id: '10000000-0000-4000-8000-000000000003',
      code: 'OLP',
      roles: ['OLP_OPERATOR'],
      permissions: ['patient_master.read'],
    });

    expect(() => resolvePatientMasterScope(actor, actor.organizations[0]!.id, USER)).toThrow(
      ForbiddenException,
    );
  });

  it('requires the separate MTD reconciliation permission', () => {
    const mtd = profile({
      id: MTD_ORG,
      code: 'MTD',
      permissions: ['patient_reconciliation.read'],
    });
    const medicarte = profile({
      id: MEDICARTE_ORG,
      code: 'MEDICARTE',
      permissions: ['patient_reconciliation.read'],
    });

    expect(() => assertPatientReconciliationReadAllowed(mtd, MTD_ORG)).not.toThrow();
    expect(() => assertPatientReconciliationReadAllowed(medicarte, MEDICARTE_ORG)).toThrow(
      ForbiddenException,
    );
  });
});
