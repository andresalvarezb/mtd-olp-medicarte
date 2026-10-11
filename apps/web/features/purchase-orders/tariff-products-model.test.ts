import { describe, expect, it } from 'vitest';
import type { TariffProductListItem } from '@/lib/tariff-products-api';
import {
  filterTariffProducts,
  numericTariff,
  sellingTariff,
  tariffDiscount,
  tariffProductMetrics,
  tariffProductName,
} from './tariff-products-model';

function product(input: Partial<TariffProductListItem> = {}): TariffProductListItem {
  return {
    id: '123',
    codigoProducto: 'MED-01',
    tarifaUnidad: '100,00',
    tarifaUnidadCanonical: '100.0000',
    tarifaCompra: '95.0000',
    numeroExpedienteInvima: 'INV-01',
    consecutivoInvimaPresentacion: '001',
    descripcionGenerica: 'Genérico',
    descripcionComercial: 'Marca',
    laboratorio: 'Lab ejemplo',
    tipoInclusion: 'PBS',
    minimumQuantity: 1,
    active: true,
    sourceCumCode: 'CUM-1',
    defaultApplicationPoint: { id: 'point-1', code: 'NORTE', name: 'Punto Norte' },
    updatedAt: '2026-10-10T00:00:00.000Z',
    ...input,
  };
}

describe('Anexo Tarifario compacto / detalle', () => {
  it('conserva TV y el valor de compra calculado por backend', () => {
    const item = product();
    expect(sellingTariff(item)).toBe(100);
    expect(numericTariff(item.tarifaCompra)).toBe(95);
    expect(tariffDiscount(item)).toBe(5);
  });

  it('no fabrica precios ni descuentos si falta la tarifa canónica', () => {
    const item = product({ tarifaUnidad: null, tarifaUnidadCanonical: null, tarifaCompra: null });
    expect(sellingTariff(item)).toBeNull();
    expect(tariffDiscount(item)).toBeNull();
    expect(tariffProductMetrics([product(), item])).toEqual({ total: 2, withTariff: 1, withoutTariff: 1 });
  });

  it('prioriza descripción genérica, después comercial y finalmente código', () => {
    expect(tariffProductName(product())).toBe('Genérico');
    expect(tariffProductName(product({ descripcionGenerica: null }))).toBe('Marca');
    expect(tariffProductName(product({ descripcionGenerica: null, descripcionComercial: null }))).toBe('MED-01');
  });

  it('conserva los filtros por nombre, cobertura y punto', () => {
    const products = [
      product(),
      product({ id: '2', codigoProducto: 'MED-02', descripcionGenerica: 'Otra', tipoInclusion: 'NO_PBS', defaultApplicationPoint: null }),
    ];
    expect(filterTariffProducts(products, { search: 'lab ejemplo', inclusion: 'PBS', point: 'point-1' })).toHaveLength(1);
    expect(filterTariffProducts(products, { search: 'MED-02', inclusion: 'NO_PBS', point: 'MISSING' })).toHaveLength(1);
    expect(filterTariffProducts(products, { search: 'sin coincidencia', inclusion: 'ALL', point: 'ALL' })).toHaveLength(0);
  });
});
