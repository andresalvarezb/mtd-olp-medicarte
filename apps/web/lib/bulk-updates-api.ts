import { apiRequest } from './api-client';
import type { BulkUpdateOperationType } from '@authorization/contracts';

export type { BulkUpdateOperationType };

export interface BulkUpdateBatch {
  id: string;
  operationType: BulkUpdateOperationType;
  status: 'CARGADO' | 'EN_COLA' | 'PROCESANDO' | 'COMPLETADO' | 'FALLIDO';
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  contractVersion: number;
  totalRows: number;
  processedRows: number;
  updatedRows: number;
  unchangedRows: number;
  rejectedRows: number;
  lastErrorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface BulkUpdateRow {
  id: string;
  rowNumber: number;
  resultCode: string;
  resultMessage: string;
  authorizationItemId: string | null;
  authorizationKey: string | null;
  fieldName: string | null;
  previousValue: string | null;
  newValue: string | null;
  fieldVersion: number | null;
  createdAt: string;
}

export function createBulkUpdate(
  operationType: BulkUpdateOperationType,
  file: File,
  organizationId: string,
  idempotencyKey: string,
): Promise<BulkUpdateBatch> {
  const body = new FormData();
  body.append('operationType', operationType);
  body.append('file', file);
  return apiRequest<BulkUpdateBatch>('/bulk-updates', {
    method: 'POST',
    organizationId,
    body,
    idempotencyKey,
  });
}

export function getBulkUpdateBatch(
  batchId: string,
  organizationId: string,
): Promise<BulkUpdateBatch> {
  return apiRequest<BulkUpdateBatch>(`/bulk-updates/${batchId}`, { organizationId });
}

export function getBulkUpdateRows(
  batchId: string,
  organizationId: string,
  limit = 50,
  cursor?: string,
): Promise<{
  items: BulkUpdateRow[];
  nextCursor: string | null;
  resultCodeCounts: Record<string, number>;
}> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  return apiRequest<{
    items: BulkUpdateRow[];
    nextCursor: string | null;
    resultCodeCounts: Record<string, number>;
  }>(`/bulk-updates/${batchId}/rows?${query.toString()}`, { organizationId });
}
