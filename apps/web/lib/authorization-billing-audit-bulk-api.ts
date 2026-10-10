import { apiRequest } from './api-client';

const ROOT = '/authorization-billing-audits/bulk';

export type BillingAuditBulkJobStatus =
  | 'READY'
  | 'INVALID'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED';

export type BillingAuditBulkRow = Readonly<{
  rowNumber: number;
  authorizationKey: string;
  result: 'COMPLIES' | 'DOES_NOT_COMPLY' | null;
  observation: string | null;
  executionStatus:
    | 'PENDING'
    | 'SKIPPED'
    | 'SUCCEEDED'
    | 'FAILED';
  errorCode: string | null;
  errorMessage: string | null;
  operationalStatus: string | null;
}>;

export type BillingAuditBulkJob = Readonly<{
  id: string;
  status: BillingAuditBulkJobStatus;
  total_rows: number;
  valid_rows: number;
  created_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
  counts: Readonly<{
    pending: number;
    succeeded: number;
    failed: number;
    skipped: number;
  }>;
  rows: BillingAuditBulkRow[];
  limit: number;
  offset: number;
}>;

export function downloadBillingAuditBulkTemplate(
  organizationId: string,
): Promise<Blob> {
  return apiRequest<Blob>(`${ROOT}/template.xlsx`, {
    organizationId,
  });
}

export function uploadBillingAuditBulk(
  organizationId: string,
  file: File,
): Promise<BillingAuditBulkJob> {
  const body = new FormData();
  body.append('file', file);

  return apiRequest<BillingAuditBulkJob>(`${ROOT}/jobs`, {
    method: 'POST',
    organizationId,
    body,
  });
}

export function getBillingAuditBulkJob(
  organizationId: string,
  jobId: string,
  limit = 100,
  offset = 0,
): Promise<BillingAuditBulkJob> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  return apiRequest<BillingAuditBulkJob>(
    `${ROOT}/jobs/${encodeURIComponent(jobId)}?${params}`,
    { organizationId },
  );
}

export function confirmBillingAuditBulk(
  organizationId: string,
  jobId: string,
): Promise<BillingAuditBulkJob> {
  return apiRequest<BillingAuditBulkJob>(
    `${ROOT}/jobs/${encodeURIComponent(jobId)}/confirm`,
    {
      method: 'POST',
      organizationId,
    },
  );
}

export function downloadBillingAuditBulkResult(
  organizationId: string,
  jobId: string,
): Promise<Blob> {
  return apiRequest<Blob>(
    `${ROOT}/jobs/${encodeURIComponent(jobId)}/result.xlsx`,
    { organizationId },
  );
}
