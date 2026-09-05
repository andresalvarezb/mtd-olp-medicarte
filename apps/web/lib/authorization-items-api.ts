import { apiRequest } from './api-client';
import type {
  AuthorizationItemDetailResponse,
  AuthorizationItemResponse,
  OperationalIndicatorsResponse,
} from '@authorization/contracts';

export interface AuthorizationItemListQuery {
  coverageType?: 'PBS' | 'NO_PBS';
  enablementStatus?: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  directionStatus?: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
  operationStatus?: 'BLOCKED' | 'READY_TO_DISPENSE' | 'DISPENSATION_REPORTED' | 'DISPENSED' | 'EXPIRED';
  applicationSiteStatus?: 'PENDING_ASSIGNMENT' | 'ASSIGNED';
  auditStatus?: 'NOT_STARTED' | 'READY' | 'IN_REVIEW' | 'REJECTED' | 'APPROVED';
  purchaseOrderEligible?: boolean;
  authorizationKey?: string;
  numeroAutorizacion?: string;
  identificacionPaciente?: string;
  cursor?: string;
  limit?: number;
}

export interface PaginatedItems {
  items: AuthorizationItemResponse[];
  nextCursor: string | null;
}

function toQuery(query: AuthorizationItemListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export function listAuthorizationItems(
  organizationId: string,
  query: AuthorizationItemListQuery = {},
  signal?: AbortSignal,
): Promise<PaginatedItems> {
  const qs = toQuery({ limit: 25, ...query });
  return apiRequest<PaginatedItems>(`/authorization-items${qs ? `?${qs}` : ''}`, { organizationId, signal });
}

export function getAuthorizationItemDetail(
  id: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<AuthorizationItemDetailResponse> {
  return apiRequest<AuthorizationItemDetailResponse>(`/authorization-items/${id}`, { organizationId, signal });
}

export function requestMipresRecheck(id: string, organizationId: string): Promise<{ itemId: string; status: string }> {
  return apiRequest<{ itemId: string; status: string }>(`/authorization-items/${id}/mipres-rechecks`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: '{}',
  });
}

export interface AuditReview {
  id: string;
  authorizationItemId: string;
  reviewNumber: number;
  status: 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  observations: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  startedBy: string;
  startedAt: string;
  findings: Array<{ id: string; code: string; description: string; createdAt: string }>;
}

export interface AuditDecision {
  review: AuditReview;
  item: AuthorizationItemResponse;
}

export function startAuditReview(
  itemId: string,
  organizationId: string,
  expectedVersion: number,
): Promise<AuditDecision> {
  return apiRequest<AuditDecision>(`/authorization-items/${itemId}/audit-reviews`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({ expectedVersion }),
  });
}

export function approveAuditReview(
  reviewId: string,
  organizationId: string,
  expectedVersion: number,
  observations?: string,
): Promise<AuditDecision> {
  return apiRequest<AuditDecision>(`/audit-reviews/${reviewId}/approve`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({ expectedVersion, ...(observations ? { observations } : {}) }),
  });
}

export function rejectAuditReview(
  reviewId: string,
  organizationId: string,
  expectedVersion: number,
  observations: string,
): Promise<AuditDecision> {
  return apiRequest<AuditDecision>(`/audit-reviews/${reviewId}/reject`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({ expectedVersion, observations }),
  });
}

export type Indicators = OperationalIndicatorsResponse;

export function getIndicators(organizationId: string, signal?: AbortSignal): Promise<Indicators> {
  return apiRequest<Indicators>('/indicators', { organizationId, signal });
}

/** Descarga binaria XLSX autenticada y dispara el guardado del navegador. */
export async function downloadFile(
  path: string,
  organizationId: string,
  filename: string,
  query: Record<string, string> = {},
): Promise<void> {
  const params = new URLSearchParams(query);
  const qs = params.toString();
  const blob = await apiRequest<Blob>(`${path}${qs ? `?${qs}` : ''}`, { organizationId });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
