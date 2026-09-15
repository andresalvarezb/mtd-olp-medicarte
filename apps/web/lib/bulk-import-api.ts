import type { BulkImportJobResponse, BulkImportRowResponse } from '@authorization/contracts';
import { apiRequest } from './api-client';

export type { BulkImportJobResponse, BulkImportRowResponse };

function qs(query: object) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

export function downloadSchedulingTemplate(organizationId: string) {
  return apiRequest<Blob>('/bulk-imports/scheduling/template.xlsx', { organizationId });
}

export function uploadSchedulingImport(organizationId: string, file: File) {
  const body = new FormData();
  body.append('file', file);
  return apiRequest<BulkImportJobResponse>('/bulk-imports/scheduling/upload', {
    method: 'POST',
    organizationId,
    body,
  });
}

export function listBulkImports(organizationId: string) {
  return apiRequest<{ items: BulkImportJobResponse[] }>('/bulk-imports', { organizationId });
}

export function getBulkImport(organizationId: string, id: string) {
  return apiRequest<BulkImportJobResponse>(`/bulk-imports/${id}`, { organizationId });
}

export function getBulkImportRows(
  organizationId: string,
  id: string,
  filter: 'ALL' | 'VALID' | 'INVALID' | 'EXECUTED' | 'FAILED' = 'ALL',
) {
  return apiRequest<{ items: BulkImportRowResponse[] }>(
    `/bulk-imports/${id}/rows${qs({ filter })}`,
    { organizationId },
  );
}

export function confirmBulkImport(organizationId: string, id: string) {
  return apiRequest<BulkImportJobResponse>(`/bulk-imports/${id}/confirm`, {
    method: 'POST',
    organizationId,
  });
}

export function cancelBulkImport(organizationId: string, id: string) {
  return apiRequest<BulkImportJobResponse>(`/bulk-imports/${id}/cancel`, {
    method: 'POST',
    organizationId,
  });
}

export function retryFailedBulkImport(organizationId: string, id: string) {
  return apiRequest<BulkImportJobResponse>(`/bulk-imports/${id}/retry-failed`, {
    method: 'POST',
    organizationId,
  });
}

export function downloadBulkImportResult(organizationId: string, id: string) {
  return apiRequest<Blob>(`/bulk-imports/${id}/result.xlsx`, { organizationId });
}

export function downloadAnalyticsExport(organizationId: string, query: object) {
  return apiRequest<Blob>(`/analytics/export.xlsx${qs(query)}`, { organizationId });
}
