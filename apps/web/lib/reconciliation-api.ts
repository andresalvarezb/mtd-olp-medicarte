import type {
  CreateReconciliationRunRequest,
  ReconciliationFindingListQuery,
  ReconciliationFindingResponse,
  ReconciliationRunResponse,
  ReconciliationRuleCatalogItem,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export function listReconciliationRuns(organizationId: string) {
  return apiRequest<{ items: ReconciliationRunResponse[] }>('/reconciliation/runs', {
    organizationId,
  });
}

export function getReconciliationRun(organizationId: string, id: string) {
  return apiRequest<ReconciliationRunResponse>(`/reconciliation/runs/${id}`, { organizationId });
}

export function listReconciliationFindings(
  organizationId: string,
  id: string,
  query: Partial<ReconciliationFindingListQuery> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const suffix = params.toString() ? `?${params}` : '';
  return apiRequest<{ items: ReconciliationFindingResponse[] }>(
    `/reconciliation/runs/${id}/findings${suffix}`,
    { organizationId },
  );
}

export function listReconciliationRules(organizationId: string) {
  return apiRequest<{ items: ReconciliationRuleCatalogItem[] }>('/reconciliation/rules', {
    organizationId,
  });
}

export function startReconciliationRun(
  organizationId: string,
  body: CreateReconciliationRunRequest = {},
) {
  return apiRequest<ReconciliationRunResponse>('/reconciliation/runs', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}
