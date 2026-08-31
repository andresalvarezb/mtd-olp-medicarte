import { API_BASE_URL, getAccessToken } from './auth';
import { apiRequest } from './api-client';

export type TariffProduct = {
  id: string;
  codigoProducto: string;
  active: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TariffProductListResponse = {
  items: TariffProduct[];
  nextCursor: string | null;
};

export type CreateTariffProductResponse = {
  product: TariffProduct;
  resultCode: 'PRODUCT_CREATED' | 'PRODUCT_EXISTING' | 'PRODUCT_REACTIVATED';
};

export type TariffImportBatch = {
  id: string;
  status: 'CARGADO' | 'VALIDANDO' | 'COMPLETADO' | 'FALLIDO';
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  totalRows: number;
  createdRows: number;
  reactivatedRows: number;
  existingRows: number;
  rejectedRows: number;
  duplicateRows: number;
  lastErrorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type TariffImportRow = {
  id: string;
  rowNumber: number;
  codigoProducto: string | null;
  resultCode:
    | 'PRODUCT_CREATED'
    | 'PRODUCT_REACTIVATED'
    | 'PRODUCT_EXISTING'
    | 'INVALID_PRODUCT_CODE'
    | 'DUPLICATE_IN_FILE'
    | 'INVALID_FILE_FORMAT'
    | 'PROCESSING_ERROR';
  resultMessage: string;
  productId: string | null;
  createdAt: string;
};

export type TariffImportRowsResponse = {
  items: TariffImportRow[];
  nextCursor: string | null;
};

export function listTariffProducts(
  organizationId: string,
  query: { codigo?: string; active?: 'true' | 'false' } = {},
): Promise<TariffProductListResponse> {
  const params = new URLSearchParams();
  if (query.codigo) params.set('codigo', query.codigo);
  if (query.active) params.set('active', query.active);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return apiRequest<TariffProductListResponse>(`/admin/tariff-annex/products${suffix}`, {
    organizationId,
  });
}

export function createTariffProduct(
  organizationId: string,
  codigoProducto: string,
): Promise<CreateTariffProductResponse> {
  return apiRequest<CreateTariffProductResponse>(`/admin/tariff-annex/products`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({ codigoProducto }),
  });
}

export function updateTariffProduct(
  organizationId: string,
  id: string,
  active: boolean,
): Promise<{ product: TariffProduct; changed: boolean }> {
  return apiRequest<{ product: TariffProduct; changed: boolean }>(
    `/admin/tariff-annex/products/${id}`,
    {
      method: 'PATCH',
      organizationId,
      body: JSON.stringify({ active }),
    },
  );
}

export function deactivateTariffProduct(
  organizationId: string,
  id: string,
): Promise<{ product: TariffProduct; changed: boolean }> {
  return apiRequest<{ product: TariffProduct; changed: boolean }>(
    `/admin/tariff-annex/products/${id}`,
    {
      method: 'DELETE',
      organizationId,
    },
  );
}

export function createTariffImport(
  organizationId: string,
  file: File,
): Promise<TariffImportBatch> {
  const form = new FormData();
  form.append('file', file, file.name);
  return apiRequest<TariffImportBatch>(`/admin/tariff-annex/imports`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: form,
  });
}

export function getTariffImport(
  organizationId: string,
  importId: string,
): Promise<TariffImportBatch> {
  return apiRequest<TariffImportBatch>(`/admin/tariff-annex/imports/${importId}`, {
    organizationId,
  });
}

export function getTariffImportRows(
  organizationId: string,
  importId: string,
): Promise<TariffImportRowsResponse> {
  return apiRequest<TariffImportRowsResponse>(`/admin/tariff-annex/imports/${importId}/rows?limit=100`, {
    organizationId,
  });
}

/** Descarga on-demand de la base de novedades EPS (no se conserva copia). */
export async function downloadEpsNovedades(
  organizationId: string,
  format: 'csv' | 'xlsx',
): Promise<void> {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE_URL}/exports/eps-novedades?format=${format}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'X-Organization-Id': organizationId,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? 'No fue posible descargar la base de novedades EPS.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `eps-novedades.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
