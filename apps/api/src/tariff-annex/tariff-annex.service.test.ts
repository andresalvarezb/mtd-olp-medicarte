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
  it('expone la tarifa de compra derivada y conserva intacta la tarifa de venta', async () => {
    const original = {
      id: '44444444-4444-4444-8444-444444444444',
      codigo_producto: 'MED-1',
      tarifa_unidad: '100,00',
      tarifa_unidad_canonical: '100.0000',
      tarifa_compra: '95.0000',
      numero_expediente_invima: null,
      consecutivo_invima_presentacion: null,
      descripcion_generica: 'Producto prueba',
      descripcion_comercial: null,
      laboratorio: null,
      tipo_inclusion: 'PBS',
      minimum_quantity: 1,
      active: true,
      source_cum_code: null,
      dispensing_point_id: null,
      dispensing_point_code: null,
      dispensing_point_name: null,
      updated_at: '2026-10-10T00:00:00.000Z',
    };
    const database = {
      db: {
        execute: vi.fn().mockResolvedValue({
          rows: [original, {
            ...original,
            id: '55555555-5555-4555-8555-555555555555',
            codigo_producto: 'MED-SIN-TARIFA',
            tarifa_unidad: null,
            tarifa_unidad_canonical: null,
            tarifa_compra: null,
          }],
        }),
      },
    };
    const service = new TariffAnnexService({} as never, database as never);
    const result = await service.listProducts(scope());

    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({
      tarifaUnidad: '100,00',
      tarifaUnidadCanonical: '100.0000',
      tarifaCompra: '95.0000',
    });
    expect(result.items[1]?.tarifaCompra).toBeNull();
  });

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
