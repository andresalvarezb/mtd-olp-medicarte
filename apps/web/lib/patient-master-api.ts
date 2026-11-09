import type {
  PatientMasterDetail,
  PatientMasterPersonalResponse,
  PatientMasterSearchRequest,
  PatientMasterSearchResponse,
  PatientMasterLiveLookupRequest,
  PatientMasterLiveLookupResponse,
  PatientReconciliationCasesResponse,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export function searchPatientMaster(
  organizationId: string,
  query: PatientMasterSearchRequest,
  signal?: AbortSignal,
): Promise<PatientMasterSearchResponse> {
  return apiRequest<PatientMasterSearchResponse>('/patient-master/search', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(query),
    signal,
  });
}

export function lookupPatientMaster(
  organizationId: string,
  query: PatientMasterLiveLookupRequest,
  signal?: AbortSignal,
): Promise<PatientMasterLiveLookupResponse> {
  return apiRequest<PatientMasterLiveLookupResponse>('/patient-master/lookup', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(query),
    signal,
  });
}

export function getPatientMasterDetail(
  organizationId: string,
  patientId: string,
  dispensingPointId?: string,
  signal?: AbortSignal,
): Promise<PatientMasterDetail> {
  const query = dispensingPointId
    ? `?dispensingPointId=${encodeURIComponent(dispensingPointId)}`
    : '';
  return apiRequest<PatientMasterDetail>(
    `/patient-master/${encodeURIComponent(patientId)}${query}`,
    {
      organizationId,
      signal,
    },
  );
}

export function getPatientMasterPersonalProfile(
  organizationId: string,
  patientId: string,
  dispensingPointId?: string,
  signal?: AbortSignal,
): Promise<PatientMasterPersonalResponse> {
  const query = dispensingPointId
    ? `?dispensingPointId=${encodeURIComponent(dispensingPointId)}`
    : '';
  return apiRequest<PatientMasterPersonalResponse>(
    `/patient-master/${encodeURIComponent(patientId)}/personal${query}`,
    { organizationId, signal },
  );
}

export function listPatientReconciliationCases(
  organizationId: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<PatientReconciliationCasesResponse> {
  return apiRequest<PatientReconciliationCasesResponse>(
    `/patient-master/reconciliation-cases?limit=${limit}`,
    { organizationId, signal },
  );
}
