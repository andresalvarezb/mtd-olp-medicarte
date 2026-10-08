import type {
  AuthorizationQueryItem,
} from './authorization-query-api';


export type AuthorizationBillingAuditDisplayInput =
  Readonly<
    Pick<
      AuthorizationQueryItem,
      | 'billingAuditDisplayStatus'
      | 'operationalStatus'
      | 'driveSupportStatus'
      | 'driveSupportEvidenceCount'
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
  /*
   * La presencia documental es independiente del
   * estado operacional de la AUTO.
   *
   * Antes del primer barrido no afirmamos que una
   * AUTO carezca de soportes.
   */
  if (
    item.driveSupportStatus ===
      'UNKNOWN'
  ) {
    return item.operationalStatus ===
      'CLOSED'
      ? 'Pendiente · Soportes por verificar'
      : 'Soportes · Pendiente de consulta';
  }


  if (
    item.operationalStatus !==
      'CLOSED'
  ) {
    return item.driveSupportEvidenceCount >
      0
      ? `Con soportes · ${item.driveSupportEvidenceCount}`
      : 'Sin soportes';
  }


  return billingAuditDisplayStatusLabel(
    item.billingAuditDisplayStatus,
  );
}
