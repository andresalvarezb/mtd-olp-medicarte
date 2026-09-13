import { apiRequest } from './api-client';
import type {
  CreatePlanningPeriodRequest,
  PaginatedPlanningPeriodsResponse,
  PlanningPeriodResponse,
  TransitionPlanningPeriodRequest,
  UpdatePlanningPeriodRequest,
} from '@authorization/contracts';

export type { PlanningPeriodResponse };

export function listPlanningPeriods(
  organizationId: string,
  signal?: AbortSignal,
): Promise<PaginatedPlanningPeriodsResponse> {
  return apiRequest<PaginatedPlanningPeriodsResponse>('/planning-periods', {
    organizationId,
    signal,
  });
}

export function getPlanningPeriod(
  organizationId: string,
  periodId: string,
): Promise<PlanningPeriodResponse> {
  return apiRequest<PlanningPeriodResponse>(`/planning-periods/${periodId}`, { organizationId });
}

export function createPlanningPeriod(
  organizationId: string,
  body: CreatePlanningPeriodRequest,
): Promise<PlanningPeriodResponse> {
  return apiRequest<PlanningPeriodResponse>('/planning-periods', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function updatePlanningPeriod(
  organizationId: string,
  periodId: string,
  body: UpdatePlanningPeriodRequest,
): Promise<PlanningPeriodResponse> {
  return apiRequest<PlanningPeriodResponse>(`/planning-periods/${periodId}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function transitionPlanningPeriod(
  organizationId: string,
  periodId: string,
  body: TransitionPlanningPeriodRequest,
): Promise<PlanningPeriodResponse> {
  return apiRequest<PlanningPeriodResponse>(`/planning-periods/${periodId}/transition`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}
