import { apiRequest } from './api-client';

export type ImportBatchStatus =
  | 'CARGADO'
  | 'VALIDANDO'
  | 'LISTO_PARA_CONFIRMAR'
  | 'CONFIRMANDO'
  | 'COMPLETADO'
  | 'FALLIDO'
  | 'CANCELADO'
  | 'REVIRTIENDO'
  | 'REVERTIDO';

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
  status: 'COMPLETADO';
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

export function getImportBatch(
  id: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<ImportBatch> {
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
  return apiRequest<ImportRowsPage>(`/imports/${id}/rows?${params.toString()}`, {
    organizationId,
    signal,
  });
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

export type ImportReversalBlockReason =
  | 'ITEM_HAS_AUDIT_ACTIVITY'
  | 'ITEM_HAS_MIPRES_ACTIVITY'
  | 'ITEM_HAS_OPERATIONAL_UPDATES'
  | 'ITEM_HAS_NOTIFICATIONS'
  | 'ITEM_HAS_UPDATED_SOURCE_EVIDENCE'
  | 'ITEM_REFERENCED_BY_LATER_IMPORT';

export interface ImportReversalBlockedItem {
  itemId: string;
  authorizationKey: string;
  reasons: ImportReversalBlockReason[];
}

export interface ImportReversalPreview {
  batchId: string;
  batchStatus: ImportBatchStatus;
  originalFilename: string;
  createdAt: string;
  createdBy: string;
  createdByEmail: string;
  createdByName: string | null;
  totalRows: number;
  confirmedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  existingRows: number;
  alreadyReverted: boolean;
  revertedAt: string | null;
  revertedRemovedItems: number;
  revertedBlockedItems: number;
  itemsCreatedByBatch: number;
  itemsEligibleForRemoval: number;
  itemsBlocked: number;
  blockedReasonCounts: Array<{ reason: ImportReversalBlockReason; count: number }>;
  blockedItems: ImportReversalBlockedItem[];
  blockedItemsTruncated: boolean;
}

export interface ImportRevertResult {
  batchId: string;
  status: 'REVERTIDO';
  alreadyReverted: boolean;
  evaluatedItems: number;
  removedItems: number;
  blockedItems: number;
  blockedItemsDetail: ImportReversalBlockedItem[];
  blockedItemsTruncated: boolean;
  revertedAt: string;
}

export function getReversalPreview(
  id: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<ImportReversalPreview> {
  return apiRequest<ImportReversalPreview>(`/imports/${id}/reversal-preview`, {
    organizationId,
    signal,
  });
}

export function revertImport(
  id: string,
  organizationId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ImportRevertResult> {
  return apiRequest<ImportRevertResult>(`/imports/${id}/revert`, {
    method: 'POST',
    organizationId,
    body: '{}',
    idempotencyKey,
    signal,
  });
}
