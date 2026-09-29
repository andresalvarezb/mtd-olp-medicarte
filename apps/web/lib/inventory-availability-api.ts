import {
  apiRequest,
} from './api-client';


export type InventoryAvailabilityItem =
  Readonly<{
    purchaseOrderId: string;

    purchaseOrderCode: string;

    commercialCode: string;

    productDescription:
      string |
      null;

    dispensingPointId:
      string |
      null;

    dispensingPointCode:
      string |
      null;

    requestedQuantity: number;

    receivedQuantity: number;

    fulfilledQuantity: number;

    assignedQuantity: number;

    availableQuantity: number;

    pendingReceiptQuantity: number;
  }>;


export type InventoryAvailabilityQuery =
  Readonly<{
    search?:
      string |
      undefined;

    purchaseOrder?:
      string |
      undefined;

    dispensingPoint?:
      string |
      undefined;
  }>;


function buildParams(
  query:
    InventoryAvailabilityQuery,

  limit?:
    number,
) {
  const params =
    new URLSearchParams();


  if (query.search) {
    params.set(
      'search',
      query.search,
    );
  }


  if (query.purchaseOrder) {
    params.set(
      'purchaseOrder',
      query.purchaseOrder,
    );
  }


  if (query.dispensingPoint) {
    params.set(
      'dispensingPoint',
      query.dispensingPoint,
    );
  }


  if (limit !== undefined) {
    params.set(
      'limit',
      String(limit),
    );
  }


  return params;
}


export function listInventoryAvailability(
  organizationId:
    string,

  query:
    InventoryAvailabilityQuery &
    Readonly<{
      limit?:
        number |
        undefined;
    }> = {},
) {
  const params =
    buildParams(
      query,
      query.limit ?? 500,
    );


  return apiRequest<{
    items:
      InventoryAvailabilityItem[];
  }>(
    `/inventory/availability?${params.toString()}`,
    {
      organizationId,
    },
  );
}


export function downloadInventoryAvailability(
  organizationId:
    string,

  query:
    InventoryAvailabilityQuery = {},
) {
  const params =
    buildParams(
      query,
    );


  return apiRequest<Blob>(
    `/inventory/availability/export.xlsx?${params.toString()}`,
    {
      organizationId,
    },
  );
}
