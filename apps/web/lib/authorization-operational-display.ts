import type {
  AuthorizationQueryItem,
} from './authorization-query-api';


export type AuthorizationOperationalDisplayInput =
  Readonly<{
    operationalStatus:
      AuthorizationQueryItem['operationalStatus'];

    fulfillmentProgressStatus:
      AuthorizationQueryItem['fulfillmentProgressStatus'];

    hasLinkedPurchaseOrder:
      boolean;
  }>;


export function authorizationOperationalLabel(
  item:
    AuthorizationOperationalDisplayInput,
): string {
  if (
    item.operationalStatus ===
      'CLOSED'
  ) {
    return 'Cerrada';
  }


  if (
    item.fulfillmentProgressStatus ===
      'PARTIAL'
  ) {
    return 'Con aplicación pendiente';
  }


  /*
   * UNASSIGNED solo significa que no existe
   * saldo físico actualmente asignado.
   *
   * La existencia de OC es una dimensión
   * independiente.
   */
  if (
    item.operationalStatus ===
      'UNASSIGNED'
  ) {
    return item.hasLinkedPurchaseOrder
      ? 'Pendiente de recepción/asignación'
      : 'Pendiente de orden de compra';
  }


  if (
    item.operationalStatus ===
      'PARTIALLY_ASSIGNED'
  ) {
    return 'Asignación parcial';
  }


  if (
    item.operationalStatus ===
      'ASSIGNED'
  ) {
    return 'Lista para entrega/aplicación';
  }


  return 'Fuera de operación';
}
