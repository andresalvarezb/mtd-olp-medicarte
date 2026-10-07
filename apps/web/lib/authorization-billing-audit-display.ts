import type {
  AuthorizationQueryItem,
} from './authorization-query-api';


export type AuthorizationBillingAuditDisplayInput =
  Readonly<
    Pick<
      AuthorizationQueryItem,
      'billingAuditDisplayStatus'
    >
  >;


export function billingAuditStatusLabel(
  status:
    AuthorizationQueryItem['billingAuditStatus'],
): 'Pendiente' | 'Revisada' {
  return status === 'REVIEWED'
    ? 'Revisada'
    : 'Pendiente';
}


export function billingAuditResultLabel(
  result:
    AuthorizationQueryItem['billingAuditResult'],
): 'Pendiente de decisión' | 'Cumple' | 'No cumple' {
  if (result === 'COMPLIES') {
    return 'Cumple';
  }

  if (result === 'DOES_NOT_COMPLY') {
    return 'No cumple';
  }

  return 'Pendiente de decisión';
}


export function billingAuditEvidenceLabel(
  evidenceCount: number,
): 'Sin soportes' | 'Con soportes' {
  return evidenceCount > 0
    ? 'Con soportes'
    : 'Sin soportes';
}


export function billingAuditDisplayStatusLabel(
  status:
    AuthorizationQueryItem['billingAuditDisplayStatus'],
):
  | 'No disponible'
  | 'Pendiente · Sin soportes'
  | 'Pendiente · Con soportes'
  | 'Revisada · Cumple · Sin soportes'
  | 'Revisada · Cumple · Con soportes'
  | 'Revisada · No cumple · Sin soportes'
  | 'Revisada · No cumple · Con soportes'
  | 'Inconsistente' {
  const labels = {
    NOT_AVAILABLE:
      'No disponible',

    PENDING_WITHOUT_EVIDENCE:
      'Pendiente · Sin soportes',

    PENDING_WITH_EVIDENCE:
      'Pendiente · Con soportes',

    COMPLIES_WITHOUT_EVIDENCE:
      'Revisada · Cumple · Sin soportes',

    COMPLIES_WITH_EVIDENCE:
      'Revisada · Cumple · Con soportes',

    DOES_NOT_COMPLY_WITHOUT_EVIDENCE:
      'Revisada · No cumple · Sin soportes',

    DOES_NOT_COMPLY_WITH_EVIDENCE:
      'Revisada · No cumple · Con soportes',

    INCONSISTENT:
      'Inconsistente',
  } satisfies Record<
    AuthorizationQueryItem['billingAuditDisplayStatus'],
    ReturnType<
      typeof billingAuditDisplayStatusLabel
    >
  >;

  return labels[status];
}


export function billingAuditColumnLabel(
  item:
    AuthorizationBillingAuditDisplayInput,
) {
  return billingAuditDisplayStatusLabel(
    item.billingAuditDisplayStatus,
  );
}
