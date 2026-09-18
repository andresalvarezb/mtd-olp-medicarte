import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TariffAnnexService } from './tariff-annex.service';

function scope(code = 'MTD') {
  return {
    organizationId: '11111111-1111-4111-8111-111111111111',
    organizationCode: code,
    userId: '22222222-2222-4222-8222-222222222222',
    correlationId: '33333333-3333-4333-8333-333333333333',
    readSensitive: false,
    isFoundationAdmin: false,
    canCrossOrganizationOperationalExport: false,
    pointAccessKind: 'unrestricted' as const,
  };
}

describe('TariffAnnexService', () => {
  it('bloquea organizaciones distintas de MTD', async () => {
    const repository = {
      prepareImport: vi.fn(),
      confirmImport: vi.fn(),
    };

    const database = {
      db: {
        execute: vi.fn(),
        transaction: vi.fn(),
      },
    };

    const service = new TariffAnnexService(repository as never, database as never);

    await expect(
      service.getImport('44444444-4444-4444-8444-444444444444', scope('MEDICARTE')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('traduce prepare not_found a 404', async () => {
    const repository = {
      prepareImport: vi.fn().mockResolvedValue({
        outcome: 'not_found',
      }),
      confirmImport: vi.fn(),
    };

    const service = new TariffAnnexService(repository as never, { db: {} } as never);

    await expect(
      service.prepareImport({
        importId: '44444444-4444-4444-8444-444444444444',
        scope: scope(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('traduce confirm override_required a 409', async () => {
    const repository = {
      prepareImport: vi.fn(),
      confirmImport: vi.fn().mockResolvedValue({
        outcome: 'override_required',
      }),
    };

    const service = new TariffAnnexService(repository as never, { db: {} } as never);

    await expect(
      service.confirmImport({
        importId: '44444444-4444-4444-8444-444444444444',
        scope: scope(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
