import type {
  CreatePatientApplicationRequest,
  PatientApplicationResponse,
  UpdatePatientApplicationRequest,
} from '@authorization/contracts';
import { apiRequest } from './api-client';
import type { PatientApplicationListQuery } from '@authorization/contracts';

export function listPatientApplications(
  organizationId: string,
  query: Partial<PatientApplicationListQuery> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  return apiRequest<{ items: PatientApplicationResponse[] }>(`/medicarte/applications?${params}`, {
    organizationId,
  });
}
export function listEligibleApplicationSchedules(organizationId: string) {
  return apiRequest<{
    items: Array<{
      id: string;
      revision: number;
      authorizationItemId: string;
      authorizationNumber: string;
      patientDocument: string | null;
      patientName: string | null;
      commercialCode: string;
      dispensingPointId: string;
      scheduledDate: string;
      quantity: number;
    }>;
  }>('/medicarte/applications/eligible-schedules', { organizationId });
}
export function createPatientApplication(
  organizationId: string,
  body: CreatePatientApplicationRequest,
) {
  return apiRequest<PatientApplicationResponse>('/medicarte/applications', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function updatePatientApplication(
  organizationId: string,
  id: string,
  body: UpdatePatientApplicationRequest,
) {
  return apiRequest<PatientApplicationResponse>(`/medicarte/applications/${id}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function confirmPatientApplication(
  organizationId: string,
  id: string,
  expectedVersion: number,
) {
  return apiRequest<PatientApplicationResponse>(`/medicarte/applications/${id}/confirm`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
export function cancelPatientApplication(
  organizationId: string,
  id: string,
  expectedVersion: number,
) {
  return apiRequest<PatientApplicationResponse>(`/medicarte/applications/${id}/cancel`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
