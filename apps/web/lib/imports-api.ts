import { apiRequest } from './api-client';

export type ImportBatchStatus =
  | 'UPLOADED'
  | 'VALIDATING'
  | 'READY_TO_CONFIRM'
  | 'CONFIRMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ImportBatch {
  id: string;
  status: ImportBatchStatus;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  duplicateRows: number;
  existingRows: number;
  confirmedRows: number;
  lastErrorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRow {
  id: string;
  rowNumber: number;
  resultCode: string;
  resultMessage: string;
  confirmable: boolean;
  authorizationItemId: string | null;
  authorizationKey: string | null;
  normalized: Record<string, unknown> | null;
  validationErrors: Array<{ field?: string; code?: string; message?: string }>;
}

export interface ImportRowsPage {
  items: ImportRow[];
  nextCursor: string | null;
}

export interface ImportConfirmResult {
  batchId: string;
  status: 'COMPLETED';
  createdRows: number;
  existingRows: number;
  confirmedAt: string;
}

export function createImport(
  file: File,
  organizationId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ImportBatch> {
  const body = new FormData();
  body.append('file', file);
  return apiRequest<ImportBatch>('/imports', {
    method: 'POST',
    organizationId,
    body,
    idempotencyKey,
    signal,
  });
}

export function getImportBatch(id: string, organizationId: string, signal?: AbortSignal): Promise<ImportBatch> {
  return apiRequest<ImportBatch>(`/imports/${id}`, { organizationId, signal });
}

export function getImportRows(
  id: string,
  organizationId: string,
  query?: { cursor?: string; limit?: number },
  signal?: AbortSignal,
): Promise<ImportRowsPage> {
  const params = new URLSearchParams();
  if (query?.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query?.limit ?? 50));
  return apiRequest<ImportRowsPage>(`/imports/${id}/rows?${params.toString()}`, { organizationId, signal });
}

export function confirmImport(
  id: string,
  organizationId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ImportConfirmResult> {
  return apiRequest<ImportConfirmResult>(`/imports/${id}/confirm`, {
    method: 'POST',
    organizationId,
    body: '{}',
    idempotencyKey,
    signal,
  });
}
