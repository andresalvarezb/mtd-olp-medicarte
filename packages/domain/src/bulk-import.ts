/**
 * ESP-014: XLSX is a transport channel, not a domain.
 * Job/row state machines, template versioning, limits and PHI-safe metadata.
 */

export const BULK_IMPORT_TYPE_SCHEDULING = 'SCHEDULING' as const;
export const ESP014_SCHEDULING_TEMPLATE_VERSION = 'ESP014_SCHEDULING_V1' as const;

export const BULK_IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const BULK_IMPORT_MAX_ROWS = 5000;
export const BULK_IMPORT_MAX_COLUMNS = 20;
export const BULK_IMPORT_MAX_SHEETS = 5;

export const SCHEDULING_TEMPLATE_REQUIRED_COLUMNS = [
  'AUTORIZACION',
  'DOCUMENTO',
  'COD_COMERCIAL',
  'CANTIDAD',
  'PUNTO',
  'FECHA_PROGRAMADA',
] as const;

export const SCHEDULING_TEMPLATE_OPTIONAL_COLUMNS = ['MANEJO_TARDIO'] as const;

export const BULK_IMPORT_JOB_STATUSES = [
  'UPLOADED',
  'VALIDATING',
  'READY',
  'INVALID',
  'PROCESSING',
  'COMPLETED',
  'PARTIALLY_COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type BulkImportJobStatus = (typeof BULK_IMPORT_JOB_STATUSES)[number];

export const BULK_IMPORT_ROW_VALIDATION_STATUSES = [
  'VALID',
  'INVALID',
  'DUPLICATE',
  'CONFLICT',
] as const;
export type BulkImportRowValidationStatus = (typeof BULK_IMPORT_ROW_VALIDATION_STATUSES)[number];

export const BULK_IMPORT_ROW_EXECUTION_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
] as const;
export type BulkImportRowExecutionStatus = (typeof BULK_IMPORT_ROW_EXECUTION_STATUSES)[number];

export type BulkImportJobTransitionError = Readonly<{
  code: 'INVALID_JOB_TRANSITION';
  from: BulkImportJobStatus;
  to: BulkImportJobStatus;
}>;

const JOB_TRANSITIONS: Record<BulkImportJobStatus, readonly BulkImportJobStatus[]> = {
  UPLOADED: ['VALIDATING', 'CANCELLED', 'FAILED'],
  VALIDATING: ['READY', 'INVALID', 'FAILED', 'CANCELLED'],
  READY: ['PROCESSING', 'CANCELLED', 'VALIDATING'],
  INVALID: ['VALIDATING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'],
  COMPLETED: [],
  PARTIALLY_COMPLETED: ['PROCESSING'],
  FAILED: ['PROCESSING'],
  CANCELLED: [],
};

export function canTransitionBulkImportJob(
  from: BulkImportJobStatus,
  to: BulkImportJobStatus,
): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function assertBulkImportJobTransition(
  from: BulkImportJobStatus,
  to: BulkImportJobStatus,
): void {
  if (!canTransitionBulkImportJob(from, to)) {
    const error: BulkImportJobTransitionError = { code: 'INVALID_JOB_TRANSITION', from, to };
    throw Object.assign(new Error(`INVALID_JOB_TRANSITION: ${from} -> ${to}`), error);
  }
}

export function canCancelBulkImportJob(status: BulkImportJobStatus): boolean {
  return status === 'UPLOADED' || status === 'VALIDATING' || status === 'READY';
}

export function canConfirmBulkImportJob(status: BulkImportJobStatus): boolean {
  return status === 'READY';
}

export function canRetryFailedBulkImportJob(status: BulkImportJobStatus): boolean {
  return status === 'PARTIALLY_COMPLETED' || status === 'FAILED';
}

export function canResumeBulkImportJob(status: BulkImportJobStatus): boolean {
  return status === 'PROCESSING';
}

export function decideBulkImportCompletion(input: {
  succeeded: number;
  failed: number;
  pending: number;
}): 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'PROCESSING' {
  if (input.pending > 0) return 'PROCESSING';
  if (input.succeeded > 0 && input.failed === 0) return 'COMPLETED';
  if (input.succeeded > 0 && input.failed > 0) return 'PARTIALLY_COMPLETED';
  if (input.failed > 0) return 'FAILED';
  return 'FAILED';
}

export function schedulingIdentityKey(input: {
  authorizationNumber: string;
  commercialCode: string;
  dispensingPoint: string;
  scheduledDate: string;
}): string {
  return [
    input.authorizationNumber.trim().toUpperCase(),
    input.commercialCode.trim().toUpperCase(),
    input.dispensingPoint.trim().toUpperCase(),
    input.scheduledDate,
  ].join('|');
}

export function findInternalSchedulingDuplicates(
  rows: ReadonlyArray<{
    rowNumber: number;
    authorizationNumber: string | null;
    commercialCode: string | null;
    dispensingPoint: string | null;
    scheduledDate: string | null;
  }>,
): ReadonlySet<number> {
  const seen = new Map<string, number>();
  const duplicates = new Set<number>();
  for (const row of rows) {
    if (
      row.authorizationNumber == null ||
      row.commercialCode == null ||
      row.dispensingPoint == null ||
      row.scheduledDate == null
    ) {
      continue;
    }
    const key = schedulingIdentityKey({
      authorizationNumber: row.authorizationNumber,
      commercialCode: row.commercialCode,
      dispensingPoint: row.dispensingPoint,
      scheduledDate: row.scheduledDate,
    });
    const first = seen.get(key);
    if (first !== undefined) {
      duplicates.add(first);
      duplicates.add(row.rowNumber);
    } else {
      seen.set(key, row.rowNumber);
    }
  }
  return duplicates;
}

export function rowIdempotencyKey(jobId: string, rowNumber: number): string {
  return `${jobId}:${rowNumber}`;
}

export function phiSafeBulkImportLog(input: {
  jobId: string;
  rowNumber?: number;
  errorCode?: string;
  status?: string;
}): Readonly<{ jobId: string; rowNumber?: number; errorCode?: string; status?: string }> {
  return {
    jobId: input.jobId,
    ...(input.rowNumber !== undefined ? { rowNumber: input.rowNumber } : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}

export function isSupportedSchedulingTemplate(version: string | null | undefined): boolean {
  return version === ESP014_SCHEDULING_TEMPLATE_VERSION;
}

export const BULK_IMPORT_ROW_CLAIM_LEASE_SECONDS = 120;

export function isExpiredBulkImportClaim(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (expiresAt == null) return true;
  return new Date(expiresAt).getTime() <= now.getTime();
}

export function canCompleteBulkImportRowClaim(input: {
  storedToken: string | null;
  storedGeneration: number;
  claimantToken: string;
  claimantGeneration: number;
}): boolean {
  return (
    input.storedToken === input.claimantToken && input.storedGeneration === input.claimantGeneration
  );
}

export function initialExecutionStatus(
  validationStatus: BulkImportRowValidationStatus,
): BulkImportRowExecutionStatus {
  return validationStatus === 'VALID' ? 'PENDING' : 'SKIPPED';
}
