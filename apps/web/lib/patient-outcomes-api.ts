import type {
  MarkPatientNotAppliedRequest,
  OperationalStatusResponse,
  PatientOperationalOutcomeResponse,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export function listOperationalStatuses(organizationId: string) {
  return apiRequest<{ items: OperationalStatusResponse[] }>('/operational-status', {
    organizationId,
  });
}
export function listPatientOutcomes(organizationId: string) {
  return apiRequest<{ items: PatientOperationalOutcomeResponse[] }>('/operational-outcomes', {
    organizationId,
  });
}
export function markPatientNotApplied(
  organizationId: string,
  scheduleId: string,
  body: MarkPatientNotAppliedRequest,
) {
  return apiRequest<PatientOperationalOutcomeResponse>(
    `/medicarte/schedules/${scheduleId}/not-applied`,
    {
      method: 'POST',
      organizationId,
      body: JSON.stringify(body),
    },
  );
}
