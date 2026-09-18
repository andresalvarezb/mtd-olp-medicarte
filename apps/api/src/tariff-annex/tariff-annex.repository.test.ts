import { describe, expect, it, vi } from 'vitest';
import { TariffAnnexRepository } from './tariff-annex.repository';

describe('TariffAnnexRepository', () => {
  it('expone prepareImport como operación transaccional', () => {
    expect(typeof TariffAnnexRepository.prototype.prepareImport).toBe('function');
  });

  it('expone confirmImport y no expone applyImport separado', () => {
    const prototype = TariffAnnexRepository.prototype as unknown as Record<string, unknown>;

    expect(typeof prototype.confirmImport).toBe('function');
    expect(prototype.applyImport).toBeUndefined();
  });

  it('puede construirse con una dependencia database compatible', () => {
    const database = {
      db: {
        transaction: vi.fn(),
      },
    };

    const repository = new TariffAnnexRepository(database as never);

    expect(repository).toBeInstanceOf(TariffAnnexRepository);
  });
});
