import { apiRequest } from './api-client';

export interface TariffProductListItem {
  id: string;
  codigoProducto: string;
  tarifaUnidad: string | null;
  tarifaUnidadCanonical: string | null;
  numeroExpedienteInvima: string | null;
  consecutivoInvimaPresentacion: string | null;
  descripcionGenerica: string | null;
  descripcionComercial: string | null;
  laboratorio: string | null;
  tipoInclusion: string | null;
  active: boolean;
  sourceCumCode: string | null;
  defaultApplicationPoint: {
    id: string;
    code: string;
    name: string;
  } | null;
  updatedAt: string;
}

export interface TariffProductListResponse {
  items: TariffProductListItem[];
  total: number;
}

export function listTariffProducts(
  organizationId: string,
  signal?: AbortSignal,
): Promise<TariffProductListResponse> {
  return apiRequest<TariffProductListResponse>('/admin/tariff-annex/products', {
    organizationId,
    signal,
  });
}
