import type { InventoryLotResponse, InventoryMovementResponse } from '@authorization/contracts';
import { apiRequest } from './api-client';

export function listInventory(organizationId: string, query: Record<string, string> = {}) {
  const params = new URLSearchParams(query);
  return apiRequest<{ items: InventoryLotResponse[] }>(`/inventory?${params}`, { organizationId });
}
export function getInventoryLot(organizationId: string, id: string) {
  return apiRequest<InventoryLotResponse>(`/inventory/lots/${id}`, { organizationId });
}
export function listInventoryMovements(organizationId: string, id: string) {
  return apiRequest<{ items: InventoryMovementResponse[] }>(`/inventory/lots/${id}/movements`, {
    organizationId,
  });
}
