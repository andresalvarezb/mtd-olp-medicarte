import type {
  CreateStockTransferRequest,
  StockTransferResponse,
  UpdateStockTransferRequest,
} from '@authorization/contracts';
import { apiRequest } from './api-client';

export function listStockTransfers(organizationId: string, status?: string) {
  return apiRequest<{ items: StockTransferResponse[] }>(
    `/inventory/transfers${status ? `?status=${status}` : ''}`,
    { organizationId },
  );
}
export function createStockTransfer(organizationId: string, body: CreateStockTransferRequest) {
  return apiRequest<StockTransferResponse>('/inventory/transfers', {
    method: 'POST',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function updateStockTransfer(
  organizationId: string,
  id: string,
  body: UpdateStockTransferRequest,
) {
  return apiRequest<StockTransferResponse>(`/inventory/transfers/${id}`, {
    method: 'PATCH',
    organizationId,
    body: JSON.stringify(body),
  });
}
export function dispatchStockTransfer(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<StockTransferResponse>(`/inventory/transfers/${id}/dispatch`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
export function receiveStockTransfer(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<StockTransferResponse>(`/inventory/transfers/${id}/receive`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
export function cancelStockTransfer(organizationId: string, id: string, expectedVersion: number) {
  return apiRequest<StockTransferResponse>(`/inventory/transfers/${id}/cancel`, {
    method: 'POST',
    organizationId,
    body: JSON.stringify({ expectedVersion }),
  });
}
