import type {
  ProjectedDemandLineResponse,
  ProjectedDemandSourceResponse,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export type { ProjectedDemandLineResponse, ProjectedDemandSourceResponse };

export function listProjectedDemand(
  organizationId: string,
  query: { planningPeriodId: string; dispensingPointId?: string; commercialCode?: string },
  signal?: AbortSignal,
): Promise<{ items: ProjectedDemandLineResponse[] }> {
  const search = new URLSearchParams({ planningPeriodId: query.planningPeriodId });
  if (query.dispensingPointId) search.set('dispensingPointId', query.dispensingPointId);
  if (query.commercialCode) search.set('commercialCode', query.commercialCode);
  return apiRequest<{ items: ProjectedDemandLineResponse[] }>(
    `/projected-demand?${search.toString()}`,
    { organizationId, signal },
  );
}

export function getProjectedDemandLine(
  organizationId: string,
  lineId: string,
): Promise<ProjectedDemandLineResponse> {
  return apiRequest<ProjectedDemandLineResponse>(`/projected-demand/${lineId}`, {
    organizationId,
  });
}

export function getProjectedDemandSources(
  organizationId: string,
  lineId: string,
): Promise<{ items: ProjectedDemandSourceResponse[] }> {
  return apiRequest<{ items: ProjectedDemandSourceResponse[] }>(
    `/projected-demand/${lineId}/sources`,
    { organizationId },
  );
}

export function consolidatePeriod(
  organizationId: string,
  periodId: string,
): Promise<{
  planningPeriodId: string;
  lineCount: number;
  sourceCount: number;
  regularQuantity: number;
  lateQuantity: number;
  projectedQuantity: number;
  consolidatedAt: string;
}> {
  return apiRequest(`/planning-periods/${periodId}/consolidate`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({}),
  });
}
