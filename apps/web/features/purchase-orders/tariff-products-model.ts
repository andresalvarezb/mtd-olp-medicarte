import type { TariffProductListItem } from '@/lib/tariff-products-api';

export type TariffProductFilters = Readonly<{
  search: string;
  inclusion: string;
  point: string;
}>;

export function tariffProductName(product: TariffProductListItem): string {
  return product.descripcionGenerica?.trim()
    || product.descripcionComercial?.trim()
    || product.codigoProducto;
}

/** La API entrega importes canónicos en formato decimal, sin separadores de miles. */
export function numericTariff(value: string | null): number | null {
  if (value === null || !/^(?:\d+)(?:[.,]\d{1,4})?$/.test(value.trim())) return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function sellingTariff(product: TariffProductListItem): number | null {
  return numericTariff(product.tarifaUnidadCanonical ?? product.tarifaUnidad);
}

export function formatTariff(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function tariffDiscount(product: TariffProductListItem): number | null {
  const tv = sellingTariff(product);
  const purchase = numericTariff(product.tarifaCompra);
  if (tv === null || purchase === null) return null;
  return Math.max(0, tv - purchase);
}

export function tariffProductMetrics(products: readonly TariffProductListItem[]) {
  const withTariff = products.filter((product) => sellingTariff(product) !== null).length;
  return {
    total: products.length,
    withTariff,
    withoutTariff: products.length - withTariff,
  };
}

export function filterTariffProducts(
  products: readonly TariffProductListItem[],
  filters: TariffProductFilters,
): TariffProductListItem[] {
  const term = filters.search.trim().toLocaleLowerCase('es');
  return products.filter((product) => {
    if (
      filters.inclusion !== 'ALL'
      && (product.tipoInclusion ?? '').trim().toUpperCase() !== filters.inclusion
    ) return false;

    if (filters.point === 'MISSING' && product.defaultApplicationPoint) return false;
    if (
      filters.point !== 'ALL'
      && filters.point !== 'MISSING'
      && product.defaultApplicationPoint?.id !== filters.point
    ) return false;

    if (!term) return true;
    return [
      product.codigoProducto,
      product.descripcionGenerica,
      product.descripcionComercial,
      product.numeroExpedienteInvima,
      product.consecutivoInvimaPresentacion,
      product.sourceCumCode,
      product.laboratorio,
      product.tipoInclusion,
      product.defaultApplicationPoint?.name,
      product.defaultApplicationPoint?.code,
    ].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(term);
  });
}
