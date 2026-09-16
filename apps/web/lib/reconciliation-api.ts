import type {
  AcceptReconciliationIssueRiskRequest,
  AssignReconciliationIssueRequest,
  CreateReconciliationIssueCommentRequest,
  CreateReconciliationRunRequest,
  ReconciliationFindingListQuery,
  ReconciliationFindingResponse,
  ReconciliationIssueCommentResponse,
  ReconciliationIssueEventResponse,
  ReconciliationIssueListQuery,
  ReconciliationIssueResponse,
  ReconciliationRunResponse,
  ReconciliationRuleCatalogItem,
  ResolveReconciliationIssueRequest,
  ListReconciliationNotificationsQuery,
  ListReconciliationOperationExecutionsQuery,
  ReconciliationNotificationResponse,
  ReconciliationOperationExecutionResponse,
  ReconciliationOperationPolicyResponse,
  TriggerManualOperationExecutionRequest,
  UpsertReconciliationOperationPolicyRequest,
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

function querySuffix(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params.toString() ? `?${params}` : '';
}

export function listReconciliationIssues(
  organizationId: string,
  query: Partial<ReconciliationIssueListQuery> = {},
) {
  return apiRequest<{ items: ReconciliationIssueResponse[] }>(
    `/reconciliation/issues${querySuffix(query)}`,
    { organizationId },
  );
}

export function getReconciliationIssue(organizationId: string, id: string) {
  return apiRequest<ReconciliationIssueResponse>(`/reconciliation/issues/${id}`, {
    organizationId,
  });
}

export function listIssueFindings(
  organizationId: string,
  id: string,
  query: Partial<ReconciliationFindingListQuery> = {},
) {
  return apiRequest<{ items: ReconciliationFindingResponse[] }>(
    `/reconciliation/issues/${id}/findings${querySuffix(query)}`,
    { organizationId },
  );
}

export function listIssueEvents(organizationId: string, id: string) {
  return apiRequest<{ items: ReconciliationIssueEventResponse[] }>(
    `/reconciliation/issues/${id}/events`,
    { organizationId },
  );
}

export function listIssueComments(organizationId: string, id: string) {
  return apiRequest<{ items: ReconciliationIssueCommentResponse[] }>(
    `/reconciliation/issues/${id}/comments`,
    { organizationId },
  );
}

export function listIssueAssignees(organizationId: string) {
  return apiRequest<{ items: Array<{ id: string; username: string; displayName: string }> }>(
    '/reconciliation/issues/assignees',
    { organizationId },
  );
}

export function acknowledgeIssue(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<ReconciliationIssueResponse>(`/reconciliation/issues/${id}/acknowledge`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}

export function assignIssue(
  organizationId: string,
  id: string,
  body: AssignReconciliationIssueRequest,
) {
  return apiRequest<ReconciliationIssueResponse>(`/reconciliation/issues/${id}/assign`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function unassignIssue(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<ReconciliationIssueResponse>(`/reconciliation/issues/${id}/unassign`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}

export function resolveIssue(
  organizationId: string,
  id: string,
  body: ResolveReconciliationIssueRequest,
) {
  return apiRequest<ReconciliationIssueResponse>(`/reconciliation/issues/${id}/resolve`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function acceptIssueRisk(
  organizationId: string,
  id: string,
  body: AcceptReconciliationIssueRiskRequest,
) {
  return apiRequest<ReconciliationIssueResponse>(`/reconciliation/issues/${id}/accept-risk`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function reopenIssue(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<ReconciliationIssueResponse>(`/reconciliation/issues/${id}/reopen`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}

export function createIssueComment(
  organizationId: string,
  id: string,
  body: CreateReconciliationIssueCommentRequest,
) {
  return apiRequest<ReconciliationIssueCommentResponse>(`/reconciliation/issues/${id}/comments`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function getOperationPolicy(organizationId: string) {
  return apiRequest<{ policy: ReconciliationOperationPolicyResponse | null }>(
    '/reconciliation/operations/policy',
    { organizationId },
  );
}

export function upsertOperationPolicy(
  organizationId: string,
  body: UpsertReconciliationOperationPolicyRequest,
) {
  return apiRequest<{ policy: ReconciliationOperationPolicyResponse }>(
    '/reconciliation/operations/policy',
    {
      method: 'PUT',
      organizationId,
      body: JSON.stringify(body),
    },
  );
}

export function enableOperationPolicy(organizationId: string) {
  return apiRequest<{ policy: ReconciliationOperationPolicyResponse }>(
    '/reconciliation/operations/policy/enable',
    {
      method: 'POST',
      organizationId,
    },
  );
}

export function disableOperationPolicy(organizationId: string) {
  return apiRequest<{ policy: ReconciliationOperationPolicyResponse }>(
    '/reconciliation/operations/policy/disable',
    {
      method: 'POST',
      organizationId,
    },
  );
}

export function listOperationExecutions(
  organizationId: string,
  query: Partial<ListReconciliationOperationExecutionsQuery> = {},
) {
  return apiRequest<{ items: ReconciliationOperationExecutionResponse[] }>(
    `/reconciliation/operations/executions${querySuffix(query)}`,
    { organizationId },
  );
}

export function getOperationExecution(organizationId: string, id: string) {
  return apiRequest<ReconciliationOperationExecutionResponse>(
    `/reconciliation/operations/executions/${id}`,
    { organizationId },
  );
}

export function cancelOperationExecution(organizationId: string, id: string) {
  return apiRequest<ReconciliationOperationExecutionResponse>(
    `/reconciliation/operations/executions/${id}/cancel`,
    {
      method: 'POST',
      organizationId,
    },
  );
}

export function triggerManualOperationExecution(
  organizationId: string,
  body: TriggerManualOperationExecutionRequest = {},
) {
  return apiRequest<{ execution: ReconciliationOperationExecutionResponse }>(
    '/reconciliation/operations/trigger',
    {
      method: 'POST',
      organizationId,
      body: JSON.stringify(body),
    },
  );
}

export function listReconciliationNotifications(
  organizationId: string,
  query: Partial<ListReconciliationNotificationsQuery> = {},
) {
  return apiRequest<{ items: ReconciliationNotificationResponse[] }>(
    `/reconciliation/notifications${querySuffix(query)}`,
    { organizationId },
  );
}

export function markNotificationRead(organizationId: string, id: string) {
  return apiRequest<ReconciliationNotificationResponse>(
    `/reconciliation/notifications/${id}/read`,
    {
      method: 'POST',
      organizationId,
    },
  );
}

export function markAllNotificationsRead(organizationId: string) {
  return apiRequest<{ updatedCount: number }>('/reconciliation/notifications/read-all', {
    method: 'POST',
    organizationId,
  });
}
