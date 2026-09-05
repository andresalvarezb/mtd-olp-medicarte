import { apiRequest } from './api-client';
import { downloadFile } from './authorization-items-api';

export type NoveltyErrorType = 'CORREGIBLE_POR_CARGUE' | 'REQUIERE_VALIDACION' | 'REPROCESABLE_INTERNAMENTE';
export type NoveltyStatus = 'PENDIENTE' | 'RESUELTO';

export type NoveltyFilters = {
  authorization?: string;
  document?: string;
  stage?: string;
  errorType?: NoveltyErrorType;
  status?: NoveltyStatus;
  batchId?: string;
  limit?: number;
};

export type Novelty = {
  id: string;
  authorizationItemId: string | null;
  authorizationKey: string | null;
  numeroAutorizacion: string | null;
  identificacionPaciente: string | null;
  codigoProducto: string | null;
  code: string;
  errorType: NoveltyErrorType;
  stage: string;
  field: string | null;
  receivedValue: string | null;
  description: string;
  status: NoveltyStatus;
  attemptCount: number;
  importBatchId: string | null;
  bulkUpdateBatchId: string | null;
  tariffAnnexImportId: string | null;
  processedAt: string;
};

export type AuthorizationReprocessResult = {
  itemId: string;
  authorizationKey: string;
  previousOperationStatus: string | null;
  operationStatus: string | null;
  previousProcessStatus: string | null;
  processStatus: string | null;
  resolvedNovelties: number;
  remainingCausales: string[];
};

function query(filters: NoveltyFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function listNovelties(organizationId: string, filters: NoveltyFilters = {}): Promise<{ items: Novelty[] }> {
  return apiRequest<{ items: Novelty[] }>(`/novelties${query({ limit: 200, ...filters })}`, { organizationId });
}

export function downloadNovelties(organizationId: string, filters: NoveltyFilters = {}): Promise<void> {
  return downloadFile(`/novelties/xlsx${query(filters)}`, organizationId, 'novedades.xlsx');
}

export function reprocessAuthorizationItem(
  organizationId: string,
  itemId: string,
  idempotencyKey: string,
): Promise<AuthorizationReprocessResult> {
  return apiRequest<AuthorizationReprocessResult>(`/authorization-items/${itemId}/reprocess`, {
    method: 'POST',
    organizationId,
    idempotencyKey,
  });
}
