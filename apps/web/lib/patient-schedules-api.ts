import type {
  CancelPatientScheduleRequest,
  CreatePatientScheduleRequest,
  DispensingPointListResponse,
  PaginatedPatientScheduleImportRowsResponse,
  PaginatedPatientSchedulesResponse,
  PatientScheduleHistoryResponse,
  PatientScheduleImportBatchResponse,
  PatientScheduleListQuery,
  PatientScheduleResponse,
  ReschedulePatientScheduleRequest,
  ScheduleAuthorizationSearchResponse,
  ScheduleTimingPreviewResponse,
  UpdatePatientScheduleRequest,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export type {
  DispensingPointResponse,
  LateHandling,
  PatientScheduleHistoryEntry,
  PatientScheduleImportBatchResponse,
  PatientScheduleImportRowResponse,
  PatientScheduleResponse,
  ScheduleAuthorizationOption,
  ScheduleTiming,
  ScheduleTimingPreviewResponse,
} from '@authorization/contracts';

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

export function listPatientSchedules(
  organizationId: string,
  query: PatientScheduleListQuery,
  signal?: AbortSignal,
): Promise<PaginatedPatientSchedulesResponse> {
  return apiRequest<PaginatedPatientSchedulesResponse>(
    `/patient-schedules${toQuery({
      authorization: query.authorization,
      patientDocument: query.patientDocument,
      planningPeriodId: query.planningPeriodId,
      dispensingPointId: query.dispensingPointId,
      status: query.status,
      commercialCode: query.commercialCode,
      limit: query.limit,
    })}`,
    { organizationId, signal },
  );
}

export function getPatientSchedule(
  organizationId: string,
  scheduleId: string,
): Promise<PatientScheduleResponse> {
  return apiRequest<PatientScheduleResponse>(`/patient-schedules/${scheduleId}`, {
    organizationId,
  });
}

export function getPatientScheduleHistory(
  organizationId: string,
  scheduleId: string,
): Promise<PatientScheduleHistoryResponse> {
  return apiRequest<PatientScheduleHistoryResponse>(
    `/patient-schedules/${scheduleId}/history`,
    { organizationId },
  );
}

export function createPatientSchedule(
  organizationId: string,
  body: CreatePatientScheduleRequest,
): Promise<PatientScheduleResponse> {
  return apiRequest<PatientScheduleResponse>('/patient-schedules', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function updatePatientSchedule(
  organizationId: string,
  scheduleId: string,
  body: UpdatePatientScheduleRequest,
): Promise<PatientScheduleResponse> {
  return apiRequest<PatientScheduleResponse>(`/patient-schedules/${scheduleId}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function reschedulePatientSchedule(
  organizationId: string,
  scheduleId: string,
  body: ReschedulePatientScheduleRequest,
): Promise<PatientScheduleResponse> {
  return apiRequest<PatientScheduleResponse>(`/patient-schedules/${scheduleId}/reschedule`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function cancelPatientSchedule(
  organizationId: string,
  scheduleId: string,
  body: CancelPatientScheduleRequest,
): Promise<PatientScheduleResponse> {
  return apiRequest<PatientScheduleResponse>(`/patient-schedules/${scheduleId}/cancel`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}

export function searchScheduleAuthorizations(
  organizationId: string,
  query: { authorization?: string; patientDocument?: string; commercialCode?: string },
  signal?: AbortSignal,
): Promise<ScheduleAuthorizationSearchResponse> {
  return apiRequest<ScheduleAuthorizationSearchResponse>(
    `/patient-schedules/authorizations${toQuery(query)}`,
    { organizationId, signal },
  );
}

export function listDispensingPoints(
  organizationId: string,
  signal?: AbortSignal,
): Promise<DispensingPointListResponse> {
  return apiRequest<DispensingPointListResponse>('/patient-schedules/dispensing-points', {
    organizationId,
    signal,
  });
}

export function previewScheduleTiming(
  organizationId: string,
  scheduledDate: string,
  signal?: AbortSignal,
): Promise<ScheduleTimingPreviewResponse> {
  return apiRequest<ScheduleTimingPreviewResponse>(
    `/patient-schedules/timing-preview${toQuery({ scheduledDate })}`,
    { organizationId, signal },
  );
}

export function listPatientScheduleImports(
  organizationId: string,
  signal?: AbortSignal,
): Promise<{ items: PatientScheduleImportBatchResponse[] }> {
  return apiRequest<{ items: PatientScheduleImportBatchResponse[] }>(
    '/patient-schedules/imports',
    { organizationId, signal },
  );
}

export function getPatientScheduleImport(
  organizationId: string,
  importId: string,
): Promise<PatientScheduleImportBatchResponse> {
  return apiRequest<PatientScheduleImportBatchResponse>(
    `/patient-schedules/imports/${importId}`,
    { organizationId },
  );
}

export function getPatientScheduleImportRows(
  organizationId: string,
  importId: string,
): Promise<PaginatedPatientScheduleImportRowsResponse> {
  return apiRequest<PaginatedPatientScheduleImportRowsResponse>(
    `/patient-schedules/imports/${importId}/rows`,
    { organizationId },
  );
}

export function createPatientScheduleImport(
  organizationId: string,
  file: File,
  idempotencyKey: string,
): Promise<PatientScheduleImportBatchResponse> {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<PatientScheduleImportBatchResponse>('/patient-schedules/imports', {
    method: 'POST',
    organizationId,
    body: form,
    idempotencyKey,
  });
}

export function confirmPatientScheduleImport(
  organizationId: string,
  importId: string,
): Promise<PatientScheduleImportBatchResponse> {
  return apiRequest<PatientScheduleImportBatchResponse>(
    `/patient-schedules/imports/${importId}/confirm`,
    { method: 'POST', organizationId },
  );
}

export function downloadPatientScheduleTemplate(organizationId: string): Promise<Blob> {
  return apiRequest<Blob>('/patient-schedules/imports/template', { organizationId });
}
