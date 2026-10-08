import {
  apiRequest,
} from './api-client';

export type AuthorizationOperationalStatus =
  | 'UNASSIGNED'
  | 'PARTIALLY_ASSIGNED'
  | 'ASSIGNED'
  | 'OUT_OF_OPERATION'
  | 'CLOSED';

export type AuthorizationValidityStatus =
  | 'IN_WINDOW'
  | 'EXPIRED'
  | 'OUTSIDE_HORIZON'
  | 'INVALID_DATE';

export type AuthorizationQueryFulfillmentStatus =
  | 'PENDING'
  | 'DELIVERED'
  | 'APPLIED';

export type AuthorizationFulfillmentProgressStatus =
  | 'PENDING'
  | 'PARTIAL'
  | 'COMPLETE';


export type AuthorizationInitialValidationStatus =
  | 'PASSED'
  | 'PENDING'
  | 'FAILED';

export type AuthorizationLifecycleStatus =
  | 'ENABLED'
  | 'PENDING'
  | 'DISABLED';

export type AuthorizationLifecycleReasonCode =
  | 'SOURCE_STATUS_BLOCKED'
  | 'PRODUCT_NOT_IN_TARIFF'
  | 'INVALID_QUANTITY'
  | 'INVALID_MINIMUM_QUANTITY'
  | 'BELOW_MINIMUM_QUANTITY'
  | 'INVALID_DATE'
  | 'EXPIRED'
  | 'TARIFF_VALIDATION_PENDING'
  | 'DIRECTION_PENDING'
  | 'COVERAGE_PENDING'
  | 'OUTSIDE_HORIZON';

export type AuthorizationLifecycleReason =
  Readonly<{
    code:
      AuthorizationLifecycleReasonCode;

    message:
      string;
  }>;

export type AuthorizationQueryAuditStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export type AuthorizationBillingAuditStatus =
  | 'PENDING'
  | 'REVIEWED';

export type AuthorizationBillingAuditResult =
  | 'COMPLIES'
  | 'DOES_NOT_COMPLY';

export type AuthorizationDriveSupportStatus =
  | 'UNKNOWN'
  | 'WITH_SUPPORT'
  | 'WITHOUT_SUPPORT';

export type AuthorizationBillingAuditDisplayStatus =
  | 'NOT_AVAILABLE'
  | 'PENDING_WITHOUT_EVIDENCE'
  | 'PENDING_WITH_EVIDENCE'
  | 'COMPLIES_WITHOUT_EVIDENCE'
  | 'COMPLIES_WITH_EVIDENCE'
  | 'DOES_NOT_COMPLY_WITHOUT_EVIDENCE'
  | 'DOES_NOT_COMPLY_WITH_EVIDENCE'
  | 'INCONSISTENT';

export type AuthorizationLinkedPurchaseOrder =
  Readonly<{
    id: string;

    purchaseOrderCode:
      string;

    sourceQuantity:
      number;

    /*
     * Saldo físico actualmente utilizable para
     * entrega/aplicación desde esta OC.
     */
    availableQuantity:
      number;
  }>;


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

  dosage:
    string | null;

  quantity:
    string | null;

  authorizedQuantity:
    number;

  fulfilledQuantity:
    number;

  remainingAuthorizedQuantity:
    number;

  fulfillmentProgressStatus:
    AuthorizationFulfillmentProgressStatus;

  assignmentDate:
    string | null;

  validityEndDate:
    string | null;

  moderatorFeeValue:
    string | null;

  version:
    number;

  enablementStatus:
    string;

  initialValidationStatus:
    AuthorizationInitialValidationStatus;

  validityStatus:
    AuthorizationValidityStatus;

  lifecycleEnablement:
    AuthorizationLifecycleStatus;

  lifecycleReasons:
    AuthorizationLifecycleReason[];

  operationalEligible:
    boolean;

  fulfillmentStatus:
    AuthorizationQueryFulfillmentStatus;

  auditStatus:
    AuthorizationQueryAuditStatus;

  billingAuditStatus:
    AuthorizationBillingAuditStatus;

  billingAuditResult:
    AuthorizationBillingAuditResult | null;

  billingAuditEvidenceCount:
    number;

  driveSupportStatus:
    AuthorizationDriveSupportStatus;

  driveSupportEvidenceCount:
    number;

  driveSupportLastCheckedAt:
    string | null;

  billingAuditDisplayStatus:
    AuthorizationBillingAuditDisplayStatus;

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

  /*
   * Indica si existe una relación durable activa
   * AUTO -> OC.
   *
   * No implica recepción ni inventario asignado.
   */
  hasLinkedPurchaseOrder:
    boolean;

  /*
   * Relación durable de la AUTO con las OCs
   * que utilizaron su Clave autorización.
   *
   * No implica asignación de inventario.
   */
  purchaseOrders:
    AuthorizationLinkedPurchaseOrder[];

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

  lifecycleEnablement?:
    AuthorizationLifecycleStatus;

  operationalStatus?:
    AuthorizationOperationalStatus;

  fulfillmentProgressStatus?:
    AuthorizationFulfillmentProgressStatus;

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

  quantity:
    number;
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
    filters.lifecycleEnablement
  ) {
    params.set(
      'lifecycleEnablement',
      filters.lifecycleEnablement,
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

  if (
    filters.fulfillmentProgressStatus
  ) {
    params.set(
      'fulfillmentProgressStatus',
      filters.fulfillmentProgressStatus,
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

export type AuthorizationHistoryDetail =
  Readonly<{
    label: string;

    value: string;
  }>;


export type AuthorizationHistoryEvent =
  Readonly<{
    id: string;

    type: string;

    occurredAt: string;

    title: string;

    description: string;

    actorName: string | null;

    organizationCode: string | null;

    details:
      AuthorizationHistoryDetail[];
  }>;


export type AuthorizationHistoryResponse =
  Readonly<{
    authorizationItemId: string;

    authorizationNumber: string;

    items:
      AuthorizationHistoryEvent[];
  }>;


export function getAuthorizationHistory(
  organizationId:
    string,

  authorizationItemId:
    string,
) {
  return apiRequest<
    AuthorizationHistoryResponse
  >(
    `/authorization-query/${authorizationItemId}/history`,
    {
      organizationId,
    },
  );
}


export type ManualEditAuthorizationInput = {
  commercialCode:
    string;

  quantity:
    number;

  validityEndDate:
    string;

  expectedVersion:
    number;
};


export function editAuthorizationManually(
  organizationId:
    string,

  authorizationItemId:
    string,

  input:
    ManualEditAuthorizationInput,
) {
  return apiRequest<{
    id:
      string;

    authorizationKey:
      string;

    commercialCode:
      string;

    quantity:
      number;

    validityEndDate:
      string;

    version:
      number;
  }>(
    `/authorizations/${authorizationItemId}/manual-edit`,
    {
      method:
        'PATCH',

      organizationId,

      body:
        JSON.stringify(
          input,
        ),
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
