import type { CreateDeliveryRequest, DeliveryResponse, CreatePurchaseOrderRequest, PurchaseOrderListQuery, PurchaseOrderResponse, UpdatePurchaseOrderRequest } from '@authorization/contracts';
import { apiRequest } from './api-client';

export function listPurchaseOrders(organizationId: string, query: Partial<PurchaseOrderListQuery> = {}) {
  const params = new URLSearchParams();
  if (query.planningPeriodId) params.set('planningPeriodId', query.planningPeriodId);
  if (query.status) params.set('status', query.status);
  return apiRequest<{ items: PurchaseOrderResponse[] }>(`/purchase-orders?${params}`, { organizationId });
}
export function getPurchaseOrder(organizationId: string, id: string) { return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}`, { organizationId }); }
export function createPurchaseOrder(organizationId: string, body: CreatePurchaseOrderRequest) { return apiRequest<PurchaseOrderResponse>('/purchase-orders', { method: 'POST', organizationId, body: JSON.stringify(body) }); }
export function updatePurchaseOrder(organizationId: string, id: string, body: UpdatePurchaseOrderRequest) { return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}`, { method: 'PATCH', organizationId, body: JSON.stringify(body) }); }
export function issuePurchaseOrder(organizationId: string, id: string, expectedVersion: number) { return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}/issue`, { method: 'POST', organizationId, body: JSON.stringify({ expectedVersion }) }); }
export function cancelPurchaseOrder(organizationId: string, id: string, expectedVersion: number) { return apiRequest<PurchaseOrderResponse>(`/purchase-orders/${id}/cancel`, { method: 'POST', organizationId, body: JSON.stringify({ expectedVersion }) }); }
export function listAvailableDemand(organizationId: string, planningPeriodId: string) { return apiRequest<{ items: Array<Record<string, unknown>> }>(`/purchase-demand/available?planningPeriodId=${planningPeriodId}`, { organizationId }); }
export function listSupplierPurchaseOrders(organizationId: string) { return apiRequest<{ items: PurchaseOrderResponse[] }>('/supplier/purchase-orders', { organizationId }); }
export function reviewSupplierLine(organizationId: string, id: string, lineId: string, body: { expectedVersion: number; acceptedQuantity: number; supplierUnitCost?: number }) { return apiRequest<PurchaseOrderResponse>(`/supplier/purchase-orders/${id}/lines/${lineId}/review`, { method: 'POST', organizationId, body: JSON.stringify(body) }); }
export function completeSupplierReview(organizationId: string, id: string, expectedVersion: number) { return apiRequest<PurchaseOrderResponse>(`/supplier/purchase-orders/${id}/complete-review`, { method: 'POST', organizationId, body: JSON.stringify({ expectedVersion }) }); }
export function listSupplierDeliveries(organizationId: string) { return apiRequest<{ items: DeliveryResponse[] }>('/supplier/deliveries', { organizationId }); }
export function listMedicarteDeliveries(organizationId: string) { return apiRequest<{ items: DeliveryResponse[] }>('/medicarte/deliveries', { organizationId }); }
export function createSupplierDelivery(organizationId: string, body: CreateDeliveryRequest) { return apiRequest<DeliveryResponse>('/supplier/deliveries', { method: 'POST', organizationId, idempotencyKey: crypto.randomUUID(), body: JSON.stringify(body) }); }
export function updateSupplierDelivery(organizationId: string, id: string, body: CreateDeliveryRequest & { expectedVersion: number }) { return apiRequest<DeliveryResponse>(`/supplier/deliveries/${id}`, { method: 'PATCH', organizationId, body: JSON.stringify(body) }); }
export function dispatchSupplierDelivery(organizationId: string, id: string, expectedVersion: number) { return apiRequest<DeliveryResponse>(`/supplier/deliveries/${id}/dispatch`, { method: 'POST', organizationId, idempotencyKey: crypto.randomUUID(), body: JSON.stringify({ expectedVersion }) }); }
export function cancelSupplierDelivery(organizationId: string, id: string, expectedVersion: number) { return apiRequest<DeliveryResponse>(`/supplier/deliveries/${id}/cancel`, { method: 'POST', organizationId, body: JSON.stringify({ expectedVersion }) }); }
