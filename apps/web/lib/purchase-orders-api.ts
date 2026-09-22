import type {
  CreateDeliveryRequest,
  DeliveryResponse,
  CreatePurchaseOrderRequest,
  PurchaseOrderListQuery,
  PurchaseOrderResponse,
  UpdatePurchaseOrderRequest,
  ReceiptResponse,
  UpdateReceiptRequest,
} from '@authorization/contracts';
import { apiRequest } from './api-client';


export type SupplierPurchaseOrderLine = {
  id: string;
  commercialCode: string;
  productDescription: string | null;
  presentation: string | null;
  dispensingPointId: string | null;
  dispensingPointCode: string | null;
  dispensingPointName: string | null;
  requestedQuantity: number;
  acceptedQuantity: number | null;
  shortage: number;
  requestedDeliveryDate: string | null;
  supplierUnitCost: string | null;
};

export type SupplierPurchaseOrderResponse = {
  id: string;
  purchaseOrderCode: string | null;
  orderType: 'STANDARD' | 'COMPLEMENTARY';
  status: string;
  version: number;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: SupplierPurchaseOrderLine[];
};

export type AvailablePurchaseDemand = {
  id: string;
  commercialCode: string;
  dispensingPointId: string | null;
  dispensingPointCode: string | null;
  dispensingPointName: string | null;
  deliveryPointMapped: boolean;
  revision: number;
  regularQuantity: number;
  lateQuantity: number;
  regularAvailable: number;
  lateAvailable: number;
  regularOverOrdered: number;
  lateOverOrdered: number;
};

export function listPurchaseOrders(
  organizationId: string,
  query: Partial<PurchaseOrderListQuery> = {},
) {
  const params = new URLSearchParams();
  if (query.planningPeriodId) params.set('planningPeriodId', query.planningPeriodId);
  if (query.status) params.set('status', query.status);
  if (query.orderType) params.set('orderType', String(query.orderType));
  if (query.purchaseOrderCode) params.set('purchaseOrderCode', String(query.purchaseOrderCode));
  if (query.commercialCode) params.set('commercialCode', String(query.commercialCode));
  if (query.dispensingPointId) params.set('dispensingPointId', String(query.dispensingPointId));
  return apiRequest<{ items: PurchaseOrderResponse[] }>(`/purchase-orders?${params}`, {
    organizationId,
  });
}
export function getPurchaseOrder(organizationId: string, id: string) {
  return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}`, { organizationId });
}
export function createPurchaseOrder(organizationId: string, body: CreatePurchaseOrderRequest) {
  return apiRequest<PurchaseOrderResponse>('/purchase-orders', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function updatePurchaseOrder(
  organizationId: string,
  id: string,
  body: UpdatePurchaseOrderRequest,
) {
  return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function issuePurchaseOrder(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}/issue`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
export function cancelPurchaseOrder(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}/cancel`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
export function listAvailableDemand(organizationId: string, planningPeriodId: string) {
  return apiRequest<{ items: AvailablePurchaseDemand[] }>(
    `/purchase-demand/available?planningPeriodId=${planningPeriodId}`,
    { organizationId },
  );
}
export function listSupplierPurchaseOrders(organizationId: string) {
  return apiRequest<{ items: SupplierPurchaseOrderResponse[] }>('/supplier/purchase-orders', {
    organizationId,
  });
}
export function reviewSupplierLine(
  organizationId: string,
  id: string,
  lineId: string,
  body: { expectedVersion: number; acceptedQuantity: number; supplierUnitCost?: number },
) {
  return apiRequest<PurchaseOrderResponse>(
    `/supplier/purchase-orders/${id}/lines/${lineId}/review`,
    { method: 'POST', organizationId, body: JSON.stringify(body) },
  );
}
export function completeSupplierReview(
  organizationId: string,
  id: string,
  expectedVersion: number,
) {
  return apiRequest<PurchaseOrderResponse>(`/supplier/purchase-orders/${id}/complete-review`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
export function listSupplierDeliveries(organizationId: string) {
  return apiRequest<{ items: DeliveryResponse[] }>('/supplier/deliveries', { organizationId });
}
export function listMedicarteDeliveries(organizationId: string) {
  return apiRequest<{ items: DeliveryResponse[] }>('/medicarte/deliveries', { organizationId });
}
export function createSupplierDelivery(organizationId: string, body: CreateDeliveryRequest) {
  return apiRequest<DeliveryResponse>('/supplier/deliveries', {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify(body),
  });
}
export function updateSupplierDelivery(
  organizationId: string,
  id: string,
  body: CreateDeliveryRequest & { expectedVersion: number },
) {
  return apiRequest<DeliveryResponse>(`/supplier/deliveries/${id}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function dispatchSupplierDelivery(
  organizationId: string,
  id: string,
  expectedVersion: number,
) {
  return apiRequest<DeliveryResponse>(`/supplier/deliveries/${id}/dispatch`, {
    method: 'POST',
    organizationId,
    idempotencyKey: crypto.randomUUID(),
    body: JSON.stringify({ expectedVersion }),
  });
}
export function cancelSupplierDelivery(
  organizationId: string,
  id: string,
  expectedVersion: number,
) {
  return apiRequest<DeliveryResponse>(`/supplier/deliveries/${id}/cancel`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
export function listPendingReceipts(organizationId: string) {
  return apiRequest<{ items: ReceiptResponse[] }>('/medicarte/receipts/pending', {
    organizationId,
  });
}
export function createReceipt(organizationId: string, deliveryId: string) {
  return apiRequest<ReceiptResponse>('/medicarte/receipts', {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ deliveryId }),
  });
}
export function updateReceipt(organizationId: string, id: string, body: UpdateReceiptRequest) {
  return apiRequest<ReceiptResponse>(`/medicarte/receipts/${id}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function confirmReceipt(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<ReceiptResponse>(`/medicarte/receipts/${id}/confirm`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}

export type PurchaseOrderImportResult = {
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  createdOrders: number;
  rejectedWorkbookBase64: string | null;

  results: Array<{
    rowNumber: number;
    status:
      | 'ACCEPTED'
      | 'REJECTED';
    purchaseOrderCode: string;
    planningPeriodId: string;
    orderType: string;
    commercialCode: string;
    quantity: number | null;
    requestedDeliveryDate:
      | string
      | null;
    purchaseOrderId:
      | string
      | null;
    errorCode:
      | string
      | null;
    errorMessage:
      | string
      | null;
  }>;
};

export function downloadPurchaseOrderTemplate(
  organizationId: string,
) {
  return apiRequest<Blob>(
    '/purchase-orders/import/template.xlsx',
    {
      organizationId,
    },
  );
}

export function uploadPurchaseOrderImport(
  organizationId: string,
  file: File,
) {
  const body =
    new FormData();

  body.append(
    'file',
    file,
  );

  return apiRequest<PurchaseOrderImportResult>(
    '/purchase-orders/import',
    {
      method: 'POST',
      organizationId,
      body,
    },
  );
}
export function returnSupplierPurchaseOrder(
  organizationId: string,
  id: string,
  expectedVersion: number,
  observation: string,
) {
  return apiRequest<SupplierPurchaseOrderResponse>(
    `/supplier/purchase-orders/${id}/return`,
    {
      method: 'POST',
      organizationId,
      body: JSON.stringify({
        expectedVersion,
        observation,
      }),
    },
  );
}
