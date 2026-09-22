import { apiRequest } from './api-client';

export type AuthorizationQueryItem = {
  id: string;

  authorizationNumber: string;

  commercialCode: string;

  patientDocument: string | null;

  patientName: string | null;

  quantity: string | null;

  assignmentDate: string | null;

  validityEndDate: string | null;

  enablementStatus: string;

  coverageType: string;

  logisticsStatus: string | null;

  purchaseOrder: string | null;

  createdAt: string;

  updatedAt: string;
};

export type AuthorizationQueryFilters = {
  authorizationNumber?: string;

  commercialCode?: string;

  patient?: string;

  enablementStatus?: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';

  coverageType?: 'PBS' | 'NO_PBS';

  page?: number;

  limit?: number;
};

export type AuthorizationQueryResponse = {
  items: AuthorizationQueryItem[];

  total: number;

  page: number;

  pageSize: number;
};

export function listAuthorizationQuery(
  organizationId: string,

  filters: AuthorizationQueryFilters,
) {
  const params = new URLSearchParams();

  if (filters.authorizationNumber) {
    params.set('authorizationNumber', filters.authorizationNumber);
  }

  if (filters.commercialCode) {
    params.set('commercialCode', filters.commercialCode);
  }

  if (filters.patient) {
    params.set('patient', filters.patient);
  }

  if (filters.enablementStatus) {
    params.set('enablementStatus', filters.enablementStatus);
  }

  if (filters.coverageType) {
    params.set('coverageType', filters.coverageType);
  }

  params.set('page', String(filters.page ?? 1));

  params.set('limit', String(filters.limit ?? 50));

  return apiRequest<AuthorizationQueryResponse>(`/authorization-query?${params}`, {
    organizationId,
  });
}
