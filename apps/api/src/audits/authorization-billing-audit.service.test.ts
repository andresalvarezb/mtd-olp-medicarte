import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';

import type { Scope } from '../common/request-scope';

import type { AuthorizationBillingAuditDriveService } from './authorization-billing-audit-drive.service';

import type { AuthorizationBillingAuditRepository } from './authorization-billing-audit.repository';

import { AuthorizationBillingAuditService } from './authorization-billing-audit.service';

const MTD_SCOPE: Scope = {
  organizationId: '00000000-0000-4000-8000-000000000001',

  organizationCode: 'MTD',

  userId: '00000000-0000-4000-8000-000000000002',

  correlationId: '00000000-0000-4000-8000-000000000003',

  readSensitive: true,
  isFoundationAdmin: false,

  canCrossOrganizationOperationalExport: false,

  pointAccessKind: 'global',
};

const NON_MTD_SCOPE: Scope = {
  ...MTD_SCOPE,
  organizationCode: 'MEDICARTE',
};

function createSubject() {
  const repository = {
    detailByAuthorizationItemId: vi.fn(),

    start: vi.fn(),
    decide: vi.fn(),

    findDriveSearchContext: vi.fn(),

    upsertDriveEvidence: vi.fn(),
  };

  const drive = {
    findEvidence: vi.fn(),
  };

  const service = new AuthorizationBillingAuditService(
    repository as unknown as AuthorizationBillingAuditRepository,

    drive as unknown as AuthorizationBillingAuditDriveService,
  );

  return {
    repository,
    drive,
    service,
  };
}

describe('AuthorizationBillingAuditService', () => {
  it('mantiene PENDING separado del resultado', async () => {
    const { repository, service } = createSubject();

    repository.detailByAuthorizationItemId.mockResolvedValue({
      outcome: 'found',
      audit: {
        status: 'PENDING',
        result: null,
      },
    });

    await expect(
      service.detail('10000000-0000-4000-8000-000000000001', MTD_SCOPE),
    ).resolves.toMatchObject({
      status: 'PENDING',
      result: null,
    });
  });

  it('COMPLIES cierra como REVIEWED', async () => {
    const { repository, service } = createSubject();

    repository.decide.mockResolvedValue({
      outcome: 'decided',
      audit: {
        status: 'REVIEWED',
        result: 'COMPLIES',
      },
    });

    await expect(
      service.decide(
        '20000000-0000-4000-8000-000000000001',
        {
          result: 'COMPLIES',
        },
        MTD_SCOPE,
      ),
    ).resolves.toMatchObject({
      status: 'REVIEWED',
      result: 'COMPLIES',
    });
  });

  it('DOES_NOT_COMPLY exige observación', async () => {
    const { service } = createSubject();

    await expect(
      service.decide(
        '30000000-0000-4000-8000-000000000001',
        {
          result: 'DOES_NOT_COMPLY',
          observation: '   ',
        },
        MTD_SCOPE,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('solo MTD puede auditar', async () => {
    const { service } = createSubject();

    await expect(
      service.detail('40000000-0000-4000-8000-000000000001', NON_MTD_SCOPE),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no permite decidir dos veces', async () => {
    const { repository, service } = createSubject();

    repository.decide.mockResolvedValue({
      outcome: 'already_reviewed',
    });

    await expect(
      service.decide(
        '50000000-0000-4000-8000-000000000001',
        {
          result: 'COMPLIES',
        },
        MTD_SCOPE,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('AUTO inexistente produce 404', async () => {
    const { repository, service } = createSubject();

    repository.start.mockResolvedValue({
      outcome: 'not_found',
    });

    await expect(
      service.start('60000000-0000-4000-8000-000000000001', MTD_SCOPE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('busca Drive usando numero_autorizacion', async () => {
    const { repository, drive, service } = createSubject();

    repository.findDriveSearchContext.mockResolvedValue({
      id: '70000000-0000-4000-8000-000000000001',
      authorizationItemId: '70000000-0000-4000-8000-000000000002',
      authorizationNumber: '262315766304477',
      status: 'PENDING',
    });

    drive.findEvidence.mockResolvedValue([
      {
        driveFileId: 'drive-file-1',
        fileName: '262315766304477.pdf',
        mimeType: 'application/pdf',
        webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
        sizeBytes: 123,
        md5Checksum: null,
        driveModifiedAt: '2026-10-02T18:24:07.545Z',
      },
    ]);

    repository.upsertDriveEvidence.mockResolvedValue({
      status: 'PENDING',
      evidence: [
        {
          fileName: '262315766304477.pdf',
        },
      ],
    });

    await expect(
      service.searchDriveEvidence('70000000-0000-4000-8000-000000000001', MTD_SCOPE),
    ).resolves.toMatchObject({
      status: 'PENDING',
      evidence: [
        {
          fileName: '262315766304477.pdf',
        },
      ],
    });

    expect(drive.findEvidence).toHaveBeenCalledWith('262315766304477');
  });

  it('no consulta Drive después de REVIEWED', async () => {
    const { repository, drive, service } = createSubject();

    repository.findDriveSearchContext.mockResolvedValue({
      id: '80000000-0000-4000-8000-000000000001',
      authorizationItemId: '80000000-0000-4000-8000-000000000002',
      authorizationNumber: '262315766304477',
      status: 'REVIEWED',
    });

    await expect(
      service.searchDriveEvidence('80000000-0000-4000-8000-000000000001', MTD_SCOPE),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(drive.findEvidence).not.toHaveBeenCalled();
  });
});
