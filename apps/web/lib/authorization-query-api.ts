import {
  apiRequest,
} from './api-client';

export type AuthorizationOperationalStatus =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'CLOSED';

export type AuthorizationFulfillmentType =
  | 'APPLICATION'
  | 'DELIVERY';

export type AuthorizationFulfillment = {
  id: string;

  type:
    string | null;

  effectiveDate:
    string | null;

  quantity:
    number | null;

  confirmedAt:
    string | null;

  source:
    string | null;
};

export type AuthorizationQueryItem = {
  id: string;

  authorizationNumber: string;

  commercialCode: string;

  productDescription:
    string | null;

  patientDocument:
    string | null;

  patientName:
    string | null;

  quantity:
    string | null;

  assignmentDate:
    string | null;

  validityEndDate:
    string | null;

  enablementStatus:
    string;

  coverageType:
    string;

  logisticsStatus:
    string | null;

  operationalStatus:
    AuthorizationOperationalStatus;

  allocatedQuantity:
    number;

  remainingAssignedQuantity:
    number;

  purchaseOrder:
    string | null;

  dispensingPointCode:
    string | null;

  dispensingPointName:
    string | null;

  fulfillment:
    AuthorizationFulfillment | null;

  createdAt:
    string;

  updatedAt:
    string;
};

export type AuthorizationQueryFilters = {
  authorizationNumber?: string;

  commercialCode?: string;

  patient?: string;

  enablementStatus?:
    | 'ENABLED'
    | 'BLOCKED_SOURCE_STATUS';

  operationalStatus?:
    AuthorizationOperationalStatus;

  coverageType?:
    | 'PBS'
    | 'NO_PBS';

  page?: number;

  limit?: number;
};

export type AuthorizationQueryResponse = {
  items:
    AuthorizationQueryItem[];

  total:
    number;

  page:
    number;

  pageSize:
    number;
};

export type FulfillAuthorizationInput = {
  purchaseOrderCode:
    string;

  fulfillmentType:
    AuthorizationFulfillmentType;

  effectiveDate:
    string;
};

export function listAuthorizationQuery(
  organizationId:
    string,

  filters:
    AuthorizationQueryFilters,
) {
  const params =
    new URLSearchParams();

  if (
    filters.authorizationNumber
  ) {
    params.set(
      'authorizationNumber',
      filters.authorizationNumber,
    );
  }

  if (
    filters.commercialCode
  ) {
    params.set(
      'commercialCode',
      filters.commercialCode,
    );
  }

  if (
    filters.patient
  ) {
    params.set(
      'patient',
      filters.patient,
    );
  }

  if (
    filters.enablementStatus
  ) {
    params.set(
      'enablementStatus',
      filters.enablementStatus,
    );
  }

  if (
    filters.coverageType
  ) {
    params.set(
      'coverageType',
      filters.coverageType,
    );
  }

  if (
    filters.operationalStatus
  ) {
    params.set(
      'operationalStatus',
      filters.operationalStatus,
    );
  }

  params.set(
    'page',
    String(
      filters.page
      ??
      1,
    ),
  );

  params.set(
    'limit',
    String(
      filters.limit
      ??
      50,
    ),
  );

  return apiRequest<
    AuthorizationQueryResponse
  >(
    `/authorization-query?${params}`,
    {
      organizationId,
    },
  );
}

export function getAuthorizationQueryItem(
  organizationId:
    string,

  id:
    string,
) {
  return apiRequest<
    AuthorizationQueryItem
  >(
    `/authorization-query/${id}`,
    {
      organizationId,
    },
  );
}

export function fulfillAuthorization(
  organizationId:
    string,

  authorizationItemId:
    string,

  input:
    FulfillAuthorizationInput,
) {
  return apiRequest<{
    id: string;
  }>(
    `/medicarte/authorizations/${authorizationItemId}/fulfill`,
    {
      method:
        'POST',

      organizationId,

      body:
        JSON.stringify(
          input,
        ),
    },
  );
}
export function downloadDispensationTemplate(
  organizationId: string,
): Promise<Blob> {
  return apiRequest<Blob>(
    '/authorizations/dispensation/template',
    {
      organizationId,
    },
  );
}


export type DispensationImportResult =
  Readonly<{
    totalRows: number;

    acceptedRows: number;

    unchangedRows: number;

    rejectedRows: number;

    results:
      ReadonlyArray<{
        rowNumber: number;

        authorizationKey:
          string | null;

        dispensationDate:
          string | null;

        status:
          | 'ACCEPTED'
          | 'REJECTED'
          | 'UNCHANGED';

        errorCode:
          string | null;

        errorMessage:
          string | null;
      }>;
  }>;


export function uploadDispensationWorkbook(
  organizationId: string,

  file: File,
): Promise<DispensationImportResult> {
  const body =
    new FormData();

  body.append(
    'file',
    file,
  );

  return apiRequest<
    DispensationImportResult
  >(
    '/authorizations/dispensation/import',
    {
      method:
        'POST',

      organizationId,

      body,
    },
  );
}



export type AuthorizationFulfillmentImportResult =
  Readonly<{
    totalRows:
      number;

    acceptedRows:
      number;

    rejectedRows:
      number;

    rejectedWorkbookBase64:
      string | null;

    results:
      ReadonlyArray<{
        rowNumber:
          number;

        authorizationKey:
          string | null;

        fulfillmentType:
          | 'APPLICATION'
          | 'DELIVERY'
          | null;

        effectiveDate:
          string | null;

        status:
          | 'ACCEPTED'
          | 'REJECTED';

        authorizationItemId:
          string | null;

        fulfillmentId:
          string | null;

        errorCode:
          string | null;

        errorMessage:
          string | null;
      }>;
  }>;


export function downloadAuthorizationFulfillmentTemplate(
  organizationId:
    string,
): Promise<Blob> {
  return apiRequest<Blob>(
    '/medicarte/authorizations/fulfillment-import/template.xlsx',
    {
      organizationId,
    },
  );
}


export function uploadAuthorizationFulfillmentWorkbook(
  organizationId:
    string,

  file:
    File,
): Promise<AuthorizationFulfillmentImportResult> {
  const body =
    new FormData();

  body.append(
    'file',
    file,
  );

  return apiRequest<
    AuthorizationFulfillmentImportResult
  >(
    '/medicarte/authorizations/fulfillment-import',
    {
      method:
        'POST',

      organizationId,

      body,
    },
  );
}
