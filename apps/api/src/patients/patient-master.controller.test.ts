import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse, PatientMasterSearchResponse } from '@authorization/contracts';
import { PatientMasterController } from './patient-master.controller';

const USER = '30000000-0000-4000-8000-000000000001';
const MTD_ORG = '10000000-0000-4000-8000-000000000001';
const MEDICARTE_ORG = '10000000-0000-4000-8000-000000000004';
const OLP_ORG = '10000000-0000-4000-8000-000000000003';
const POINT_A = '20000000-0000-4000-8000-000000000001';
const PATIENT = '40000000-0000-4000-8000-000000000001';

function profile(input: {
  organizationId: string;
  organizationCode: string;
  role: string;
  permissions: string[];
  pointAccess?: MeResponse['organizations'][number]['pointAccess'];
}): MeResponse {
  return {
    id: USER,
    username: 'synthetic-user',
    displayName: 'Synthetic User',
    mustChangePassword: false,
    organizations: [
      {
        id: input.organizationId,
        code: input.organizationCode,
        name: 'Synthetic organization',
        roles: [input.role],
        isSystemAdmin: false,
        permissions: input.permissions,
        pointAccess: input.pointAccess ?? { kind: 'unrestricted', accessiblePointIds: [] },
      },
    ],
  };
}

function fixture(organizationProfile: MeResponse) {
  const response: PatientMasterSearchResponse = {
    items: [
      {
        id: PATIENT,
        identityStatus: 'LOCAL_KEY_RECORDED',
        mtdomLookupStatus: 'NOT_FOUND',
        mtdomLastCheckedAt: '2026-01-15T10:00:00.000Z',
        mtdomLastErrorCode: null,
        mtdomChangesSeenAt: null,
        linkedAuthorizationCount: 1,
        historicalCandidateAuthorizationCount: 1,
      },
    ],
    page: 1,
    limit: 25,
    total: 1,
  };
  const service = {
    search: vi.fn().mockResolvedValue(response),
    detail: vi.fn().mockResolvedValue({
      ...response.items[0],
      basicProfile: {
        tipo_identificacion: 'SINTETICO',
        identificacion: 'NO-REAL-001',
        primer_nombre: 'FICTICIO',
        segundo_nombre: null,
        primer_apellido: 'PRUEBA',
        segundo_apellido: null,
        sexo: null,
        ciudad: null,
        codigo_ciudad: null,
        departamento: null,
        codigo_departamento: null,
        eps: null,
        codigo_eps: null,
        plan: null,
        codigo_plan: null,
        tipo: null,
        codigo_tipo: null,
        condicion: null,
        activo: null,
        paciente_vivo: null,
        fecha_fallecimiento: null,
        presente_en_fuente_actual: null,
        registraduria_estado: null,
        fecha_ultima_validacion_registraduria: null,
        actualizado_en: '2026-11-08T00:00:00Z',
      },
      basicProfileMetadata: {
        source: 'MTDOM',
        fetchedAt: '2026-11-08T00:00:00.000Z',
        sourceUpdatedAt: null,
      },
      authorizationEvidence: [
        {
          id: '50000000-0000-4000-8000-000000000001',
          authorizationNumber: 'AUT-DEMO-001',
          linkage: 'HISTORICAL_EXACT_CANDIDATE',
          organizationCodes: [organizationProfile.organizations[0]!.code],
          dispensingPointId: POINT_A,
        },
      ],
    }),
    reconciliationCases: vi.fn().mockResolvedValue([]),
    personalProfile: vi.fn().mockResolvedValue({ patientId: PATIENT, personalProfile: null }),
  };
  const access = {
    requirePermission: vi.fn().mockResolvedValue(organizationProfile),
  };
  const controller = new PatientMasterController(
    service as never,
    access as never,
    { PATIENT_MASTER_ACCESS_ENABLED: true } as never,
  );
  return { controller, service, access };
}

const request = { auth: { sub: USER } } as never;

describe('PatientMasterController', () => {
  it('keeps API routes closed when the feature gate is off', async () => {
    const service = { search: vi.fn() };
    const access = { requirePermission: vi.fn() };
    const controller = new PatientMasterController(
      service as never,
      access as never,
      { PATIENT_MASTER_ACCESS_ENABLED: false } as never,
    );

    await expect(
      controller.search({ page: 1, limit: 25 }, MTD_ORG, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(access.requirePermission).not.toHaveBeenCalled();
    expect(service.search).not.toHaveBeenCalled();
  });

  it('keeps synthetic profile fields out of the API while DP-07 is closed', async () => {
    const setup = fixture(
      profile({
        organizationId: MTD_ORG,
        organizationCode: 'MTD',
        role: 'MTD_ADMIN',
        permissions: ['patient_master.read'],
      }),
    );
    const response = await setup.controller.detail(PATIENT, undefined, MTD_ORG, request);
    expect(response.basicProfile).toBeNull();
    expect(response.basicProfileMetadata).toBeNull();
    expect(setup.service.detail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: MTD_ORG }),
      PATIENT,
      false,
    );
    expect(JSON.stringify(response)).not.toContain('FICTICIO');
    expect(JSON.stringify(response)).not.toContain('NO-REAL-001');
  });

  it('blocks personal profile even when a test profile contains its capability while DP-07 is closed', async () => {
    const setup = fixture(
      profile({
        organizationId: MTD_ORG,
        organizationCode: 'MTD',
        role: 'MTD_ADMIN',
        permissions: ['patient_master.personal.read'],
      }),
    );
    await expect(
      setup.controller.personalProfile(PATIENT, undefined, MTD_ORG, request),
    ).rejects.toMatchObject({ response: { code: 'PATIENT_MASTER_ACCESS_DISABLED' } });
    expect(setup.access.requirePermission).not.toHaveBeenCalled();
    expect(setup.service.personalProfile).not.toHaveBeenCalled();
  });

  it('searches only after the dedicated permission and returns a PII-minimized contract', async () => {
    const setup = fixture(
      profile({
        organizationId: MTD_ORG,
        organizationCode: 'MTD',
        role: 'MTD_ADMIN',
        permissions: ['patient_master.read'],
      }),
    );
    const response = await setup.controller.search(
      {
        identificationType: 'SINTETICO',
        identificationValue: 'TEST-ID-001',
        page: 1,
        limit: 25,
      },
      MTD_ORG,
      request,
    );

    expect(setup.access.requirePermission).toHaveBeenCalledWith(
      USER,
      MTD_ORG,
      'patient_master.read',
    );
    expect(setup.service.search).toHaveBeenCalledWith(
      expect.objectContaining({ organizationCode: 'MTD' }),
      expect.objectContaining({
        identificationType: 'SINTETICO',
        identificationValue: 'TEST-ID-001',
      }),
    );
    expect(JSON.stringify(response)).not.toContain('TEST-ID-001');
    expect(JSON.stringify(response)).not.toContain('document');
  });

  it('denies a legacy Medicarte master grant before querying any patient data', async () => {
    const setup = fixture(
      profile({
        organizationId: MEDICARTE_ORG,
        organizationCode: 'MEDICARTE',
        role: 'MEDICARTE_OPERATOR',
        permissions: ['patient_master.read'],
        pointAccess: { kind: 'explicit', accessiblePointIds: [POINT_A] },
      }),
    );
    await expect(
      setup.controller.search(
        { dispensingPointId: POINT_A, page: 1, limit: 25 },
        MEDICARTE_ORG,
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setup.service.search).not.toHaveBeenCalled();
  });

  it('denies OLP even if a malformed profile contains the master permission', async () => {
    const setup = fixture(
      profile({
        organizationId: OLP_ORG,
        organizationCode: 'OLP',
        role: 'OLP_OPERATOR',
        permissions: ['patient_master.read'],
      }),
    );

    await expect(
      setup.controller.search({ page: 1, limit: 25 }, OLP_ORG, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setup.service.search).not.toHaveBeenCalled();
  });

  it('denies Medicarte reconciliation without granting that function to its read-only master scope', async () => {
    const setup = fixture(
      profile({
        organizationId: MEDICARTE_ORG,
        organizationCode: 'MEDICARTE',
        role: 'MEDICARTE_OPERATOR',
        permissions: ['patient_reconciliation.read'],
      }),
    );

    await expect(
      setup.controller.reconciliationCases({}, MEDICARTE_ORG, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setup.service.reconciliationCases).not.toHaveBeenCalled();
  });

  it('passes the authorized MTD organization into reconciliation queries', async () => {
    const setup = fixture(
      profile({
        organizationId: MTD_ORG,
        organizationCode: 'MTD',
        role: 'MTD_ADMIN',
        permissions: ['patient_reconciliation.read'],
      }),
    );

    await setup.controller.reconciliationCases({ limit: 12 }, MTD_ORG, request);

    expect(setup.access.requirePermission).toHaveBeenCalledWith(
      USER,
      MTD_ORG,
      'patient_reconciliation.read',
    );
    expect(setup.service.reconciliationCases).toHaveBeenCalledWith(MTD_ORG, 12);
  });
});
