import { apiRequest } from './api-client';
import { getAccessToken } from './auth';
import { API_BASE_URL } from './config';
import { ApiError } from './api-client';

export type TariffImportStatus = 'UPLOADED' | 'VALIDATING' | 'COMPLETED' | 'FAILED';

export interface TariffProduct {
  id: string;
  codigoProducto: string;
  active: boolean;
  version: number;
  createdBy: string;
  tarifaUnidad: string | null;
  numeroExpedienteInvima: string | null;
  consecutivoInvimaPresentacion: string | null;
  descripcionGenerica: string | null;
  descripcionComercial: string | null;
  laboratorio: string | null;
  tipoInclusion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TariffProductsPage {
  items: TariffProduct[];
  nextCursor: string | null;
}

export interface TariffImportBatch {
  id: string;
  status: TariffImportStatus;
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
}

export interface TariffImportsPage {
  items: TariffImportBatch[];
  nextCursor: string | null;
}

export interface TariffImportRow {
  id: string;
  rowNumber: number;
  codigoProducto: string | null;
  resultCode: string;
  resultMessage: string;
  productId: string | null;
  createdAt: string;
}

export interface TariffImportRowsPage {
  items: TariffImportRow[];
  nextCursor: string | null;
}

export function listTariffProducts(
  organizationId: string,
  query?: { codigo?: string | undefined; active?: 'true' | 'false' | undefined; cursor?: string | undefined; limit?: number | undefined },
  signal?: AbortSignal,
): Promise<TariffProductsPage> {
  const params = new URLSearchParams();
  if (query?.codigo) params.set('codigo', query.codigo);
  if (query?.active) params.set('active', query.active);
  if (query?.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query?.limit ?? 25));
  return apiRequest<TariffProductsPage>(`/admin/tariff-annex/products?${params.toString()}`, {
    organizationId,
    signal,
  });
}

export function createTariffProduct(
  organizationId: string,
  codigoProducto: string,
  idempotencyKey: string,
): Promise<{ product: TariffProduct; resultCode: string }> {
  return apiRequest<{ product: TariffProduct; resultCode: string }>(
    '/admin/tariff-annex/products',
    {
      method: 'POST',
      organizationId,
      body: JSON.stringify({ codigoProducto }),
      idempotencyKey,
    },
  );
}

export function updateTariffProduct(
  organizationId: string,
  productId: string,
  active: boolean,
): Promise<{ product: TariffProduct; changed: boolean }> {
  return apiRequest<{ product: TariffProduct; changed: boolean }>(
    `/admin/tariff-annex/products/${productId}`,
    {
      method: 'PATCH',
      organizationId,
      body: JSON.stringify({ active }),
    },
  );
}

export function deactivateTariffProduct(
  organizationId: string,
  productId: string,
): Promise<{ product: TariffProduct; changed: boolean }> {
  return apiRequest<{ product: TariffProduct; changed: boolean }>(
    `/admin/tariff-annex/products/${productId}`,
    { method: 'DELETE', organizationId },
  );
}

export function createTariffImport(
  organizationId: string,
  file: File,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<TariffImportBatch> {
  const body = new FormData();
  body.append('file', file);
  return apiRequest<TariffImportBatch>('/admin/tariff-annex/imports', {
    method: 'POST',
    organizationId,
    body,
    idempotencyKey,
    signal,
  });
}

export function listTariffImports(
  organizationId: string,
  query?: { cursor?: string | undefined; limit?: number | undefined },
  signal?: AbortSignal,
): Promise<TariffImportsPage> {
  const params = new URLSearchParams();
  if (query?.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query?.limit ?? 10));
  return apiRequest<TariffImportsPage>(`/admin/tariff-annex/imports?${params.toString()}`, {
    organizationId,
    signal,
  });
}

export function getTariffImport(
  organizationId: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<TariffImportBatch> {
  return apiRequest<TariffImportBatch>(`/admin/tariff-annex/imports/${batchId}`, {
    organizationId,
    signal,
  });
}

export function listTariffImportRows(
  organizationId: string,
  batchId: string,
  query?: { cursor?: string | undefined; limit?: number | undefined },
  signal?: AbortSignal,
): Promise<TariffImportRowsPage> {
  const params = new URLSearchParams();
  if (query?.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query?.limit ?? 50));
  return apiRequest<TariffImportRowsPage>(
    `/admin/tariff-annex/imports/${batchId}/rows?${params.toString()}`,
    { organizationId, signal },
  );
}

export async function downloadEpsNovedades(
  organizationId: string,
  format: 'csv' | 'xlsx',
): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = { 'X-Organization-Id': organizationId };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(
    `${API_BASE_URL}/admin/tariff-annex/eps-novedades?format=${format}`,
    { headers },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      correlationId?: string;
    } | null;
    throw new ApiError(
      response.status,
      payload?.code ?? `HTTP_${response.status}`,
      payload?.message ?? 'No fue posible descargar las novedades EPS.',
      payload?.correlationId ?? null,
      null,
    );
  }
  const blob = await response.blob();
  return { blob, filename: `eps-novedades.${format}` };
}
