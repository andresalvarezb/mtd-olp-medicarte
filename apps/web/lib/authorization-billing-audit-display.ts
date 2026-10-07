import type {
  AuthorizationQueryItem,
} from './authorization-query-api';


export type AuthorizationBillingAuditDisplayInput =
  Readonly<
    Pick<
      AuthorizationQueryItem,
      | 'operationalStatus'
      | 'billingAuditStatus'
    >
  >;


export function billingAuditStatusLabel(
  status:
    AuthorizationQueryItem['billingAuditStatus'],
): 'Pendiente' | 'Revisada' {
  return status ===
    'REVIEWED'
    ? 'Revisada'
    : 'Pendiente';
}


export function billingAuditColumnLabel(
  item:
    AuthorizationBillingAuditDisplayInput,
): 'No disponible' | 'Pendiente' | 'Revisada' {
  /*
   * La auditoría de facturación únicamente queda
   * disponible cuando la AUTO está cerrada.
   *
   * billingAuditStatus usa PENDING como proyección
   * canónica incluso antes de que exista una
   * auditoría persistida, por lo que no debemos
   * mostrar "Pendiente" prematuramente.
   */
  if (
    item.operationalStatus !==
      'CLOSED'
  ) {
    return 'No disponible';
  }


  return billingAuditStatusLabel(
    item.billingAuditStatus,
  );
}
