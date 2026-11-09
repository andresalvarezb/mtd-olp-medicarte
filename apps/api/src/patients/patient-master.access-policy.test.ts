import { describe, expect, it } from 'vitest';
import type { MeResponse } from '@authorization/contracts';
import { ForbiddenException } from '@nestjs/common';
import {
  assertPatientReconciliationReadAllowed,
  resolvePatientMasterScope,
  resolvePatientMasterLiveLookupScope,
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
  it('allows an explicitly global MTD master read', () => {
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
      pointAccessKind: 'global',
    });
  });

  it('keeps explicit grants limited to their points and rejects requested-point escalation', () => {
    const actor = profile({
      id: MTD_ORG,
      code: 'MTD',
      permissions: ['patient_master.read'],
      pointAccess: { kind: 'explicit', accessiblePointIds: [POINT_A] },
    });
    expect(resolvePatientMasterScope(actor, MTD_ORG, USER)).toMatchObject({
      pointAccessKind: 'explicit',
      accessiblePointIds: [POINT_A],
      dispensingPointId: null,
    });
    expect(resolvePatientMasterScope(actor, MTD_ORG, USER, POINT_A).dispensingPointId).toBe(
      POINT_A,
    );
    expect(() => resolvePatientMasterScope(actor, MTD_ORG, USER, POINT_B)).toThrow(
      ForbiddenException,
    );
  });

  it('denies MTD users without effective point grants', () => {
    for (const pointAccess of [
      { kind: 'explicit' as const, accessiblePointIds: [] },
      { kind: 'unrestricted' as const, accessiblePointIds: [] },
    ]) {
      const actor = profile({
        id: MTD_ORG,
        code: 'MTD',
        permissions: ['patient_master.read'],
        pointAccess,
      });
      expect(() => resolvePatientMasterScope(actor, MTD_ORG, USER)).toThrow(ForbiddenException);
    }
  });

  it('keeps regular MTD access policy separate from live point-grant policy', () => {
    const operator = profile({
      id: MTD_ORG,
      code: 'MTD',
      roles: ['MTD_OPERATOR'],
      permissions: ['patient_master.read'],
      pointAccess: { kind: 'global', accessiblePointIds: [] },
    });
    expect(resolvePatientMasterScope(operator, MTD_ORG, USER)).toMatchObject({
      pointAccessKind: 'global',
    });
  });

  it('requires actual MEDICARTE point grants for live MTD_OPERATOR lookup', () => {
    const operator = profile({
      id: MTD_ORG,
      code: 'MTD',
      roles: ['MTD_OPERATOR'],
      permissions: ['patient_master.read'],
      pointAccess: { kind: 'explicit', accessiblePointIds: [POINT_A] },
    });
    expect(() => resolvePatientMasterLiveLookupScope(operator, MTD_ORG, USER, [])).toThrow(
      ForbiddenException,
    );
    expect(resolvePatientMasterLiveLookupScope(operator, MTD_ORG, USER, [POINT_A])).toMatchObject({
      pointAccessKind: 'explicit',
      accessiblePointIds: [POINT_A],
      dispensingPointId: null,
    });
    expect(() =>
      resolvePatientMasterLiveLookupScope(operator, MTD_ORG, USER, [POINT_A], POINT_B),
    ).toThrow(ForbiddenException);
  });

  it('denies Medicarte even with a legacy grant and explicit point access', () => {
    const actor = profile({
      id: MEDICARTE_ORG,
      code: 'MEDICARTE',
      roles: ['MEDICARTE_OPERATOR'],
      permissions: ['patient_master.read'],
      pointAccess: { kind: 'explicit', accessiblePointIds: [POINT_A] },
    });

    expect(() => resolvePatientMasterScope(actor, MEDICARTE_ORG, USER, POINT_A)).toThrow(
      ForbiddenException,
    );
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
