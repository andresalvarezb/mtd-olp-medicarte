import { apiRequest } from './api-client';

export type InventoryAvailabilityItem = Readonly<{
  purchaseOrderId: string;

  purchaseOrderCode: string;

  commercialCode: string;

  productDescription: string | null;

  dispensingPointId: string | null;

  dispensingPointCode: string | null;

  requestedQuantity: number;

  receivedQuantity: number;

  fulfilledQuantity: number;

  availableQuantity: number;

  pendingReceiptQuantity: number;
}>;

export type AvailabilityImportRow = Readonly<{
  rowNumber: number;

  authorizationKey: string;

  purchaseOrderCode: string;

  requestedQuantity: number;

  commercialCode: string | null;

  validationStatus: string;

  executionStatus?: string;

  errorCode: string | null;

  errorMessage: string | null;
}>;

export type AvailabilityImportBatch = Readonly<{
  id: string;

  status: string;

  totalRows: number;

  validRows: number;

  invalidRows: number;

  allocatedQuantity?: number;

  rows: AvailabilityImportRow[];
}>;

export type AvailabilityImportHistoryItem = Readonly<{
  id: string;

  status: string;

  totalRows: number;

  validRows: number;

  invalidRows: number;

  allocatedQuantity: number;

  originalFilename: string;

  createdAt: string;

  confirmedAt: string | null;
}>;

export function listInventoryAvailability(
  organizationId: string,
  query: {
    search?: string | undefined;

    purchaseOrder?: string | undefined;

    dispensingPoint?: string | undefined;

    limit?: number | undefined;
  } = {},
) {
  const params = new URLSearchParams();

  if (query.search) {
    params.set('search', query.search);
  }

  if (query.purchaseOrder) {
    params.set('purchaseOrder', query.purchaseOrder);
  }

  if (query.dispensingPoint) {
    params.set('dispensingPoint', query.dispensingPoint);
  }

  params.set('limit', String(query.limit ?? 500));

  return apiRequest<{
    items: InventoryAvailabilityItem[];
  }>(`/inventory/availability?${params.toString()}`, {
    organizationId,
  });
}

export function listAvailabilityImports(organizationId: string, limit = 50) {
  return apiRequest<{
    items: AvailabilityImportHistoryItem[];
  }>(`/inventory/availability/imports?limit=${limit}`, {
    organizationId,
  });
}

export function getAvailabilityImport(organizationId: string, id: string) {
  return apiRequest<AvailabilityImportBatch>(`/inventory/availability/imports/${id}`, {
    organizationId,
  });
}

export function downloadAvailabilityTemplate(organizationId: string) {
  return apiRequest<Blob>('/inventory/availability/template.xlsx', {
    organizationId,
  });
}

export function prepareAvailabilityImport(organizationId: string, file: File) {
  const form = new FormData();

  form.append('file', file);

  return apiRequest<AvailabilityImportBatch>('/inventory/availability/imports/prepare', {
    method: 'POST',

    organizationId,

    body: form,
  });
}

export function confirmAvailabilityImport(organizationId: string, id: string) {
  return apiRequest<{
    id: string;

    status: string;

    rows: number;

    allocatedQuantity: number;
  }>(`/inventory/availability/imports/${id}/confirm`, {
    method: 'POST',

    organizationId,
  });
}
