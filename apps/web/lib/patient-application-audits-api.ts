import type {
  ApplicationAuditListQuery,
  ApplicationAuditResponse,
  ApproveApplicationAuditRequest,
  RejectApplicationAuditRequest,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export function listPatientApplicationAudits(
  organizationId: string,
  query: Partial<ApplicationAuditListQuery> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return apiRequest<{ items: ApplicationAuditResponse[] }>(`/application-audits?${params}`, {
    organizationId,
  });
}

export function getPatientApplicationAudit(organizationId: string, id: string) {
  return apiRequest<ApplicationAuditResponse>(`/application-audits/${id}`, { organizationId });
}

export function startPatientApplicationAudit(organizationId: string, applicationId: string) {
  return apiRequest<ApplicationAuditResponse>(`/applications/${applicationId}/audit/start`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({}),
  });
}

export function approvePatientApplicationAudit(
  organizationId: string,
  id: string,
  body: ApproveApplicationAuditRequest,
) {
  return apiRequest<ApplicationAuditResponse>(`/application-audits/${id}/approve`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function rejectPatientApplicationAudit(
  organizationId: string,
  id: string,
  body: RejectApplicationAuditRequest,
) {
  return apiRequest<ApplicationAuditResponse>(`/application-audits/${id}/reject`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}
