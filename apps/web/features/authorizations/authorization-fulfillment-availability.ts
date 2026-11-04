type AuthorizationFulfillmentAvailabilityInput = Readonly<{
  canManage: boolean;
  expiryAttentionStatus: string;
  operationalStatus: string;
  remainingAuthorizedQuantity: number;
  remainingAssignedQuantity: number;
  activePurchaseOrderCount: number;
}>;

export function canStartAuthorizationFulfillment(
  input: AuthorizationFulfillmentAvailabilityInput,
): boolean {
  return (
    input.canManage &&
    ['CURRENT', 'GRACE', 'PARTIAL_CONTINUATION'].includes(input.expiryAttentionStatus) &&
    (input.operationalStatus === 'ASSIGNED' || input.operationalStatus === 'PARTIALLY_ASSIGNED') &&
    input.remainingAuthorizedQuantity > 0 &&
    input.remainingAssignedQuantity > 0 &&
    input.activePurchaseOrderCount > 0
  );
}

export function authorizationFulfillmentBlockMessage(expiryAttentionStatus: string): string | null {
  if (expiryAttentionStatus === 'BLOCKED_AFTER_GRACE') {
    return 'La autorización superó los cinco días de gracia sin una entrega o aplicación confirmada. No admite nuevas atenciones; sus reservas y vínculos de compra se liberan conservando el historial.';
  }

  if (expiryAttentionStatus === 'COMPLETE') {
    return 'La autorización agotó la cantidad autorizada. El historial y la trazabilidad se conservan.';
  }

  if (expiryAttentionStatus === 'INVALID_DATE') {
    return 'No se puede determinar una ventana segura de atención porque la fecha de vigencia no es válida.';
  }

  return null;
}

export function authorizationFulfillmentWindowLabel(expiryAttentionStatus: string): string | null {
  const labels: Record<string, string> = {
    CURRENT: 'Atención dentro de vigencia',
    GRACE: 'Vencida: período de gracia (días 1 a 5)',
    PARTIAL_CONTINUATION: 'Vencida: continuidad por atención confirmada',
    BLOCKED_AFTER_GRACE: 'Vencida: bloqueada desde el día 6 sin atención',
    COMPLETE: 'Atención completa',
    INVALID_DATE: 'Fecha de vigencia inválida',
  };

  return labels[expiryAttentionStatus] ?? null;
}
