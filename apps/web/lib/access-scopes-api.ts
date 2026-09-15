import { apiRequest } from './api-client';
import type {
  AssignableDispensingPoint,
  OperationalPointScopeResponse,
  ReplaceOperationalPointScopeRequest,
} from '@authorization/contracts';

export function listAssignablePoints(
  organizationId: string,
  signal?: AbortSignal,
): Promise<{ items: AssignableDispensingPoint[] }> {
  return apiRequest<{ items: AssignableDispensingPoint[] }>('/access-scopes/assignable-points', {
    organizationId,
    signal,
  });
}

export function getUserPointScope(
  organizationId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<OperationalPointScopeResponse> {
  return apiRequest<OperationalPointScopeResponse>(`/access-scopes/users/${userId}/points`, {
    organizationId,
    signal,
  });
}

export function replaceUserPointScope(
  organizationId: string,
  userId: string,
  body: ReplaceOperationalPointScopeRequest,
): Promise<OperationalPointScopeResponse> {
  return apiRequest<OperationalPointScopeResponse>(`/access-scopes/users/${userId}/points`, {
    method: 'PUT',
    organizationId,
    body: JSON.stringify(body),
  });
}
