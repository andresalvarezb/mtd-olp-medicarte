import { normalizeSourceText, parseVigenciaDate } from './authorization-classification';

/**
 * SPEC-014 / ADR-024: el Anexo Tarifario define los códigos de producto
 * habilitados para el proceso. La llave de cruce es
 * `authorization_items.codigo_medicamento` (COD_COMERCIAL normalizado) contra
 * `tariff_annex_products.codigo_producto` (misma normalización técnica).
 */
export const TARIFF_ANNEX_RULE_VERSION = 'TARIFF-ANNEX-1';

export const MAX_TARIFF_PRODUCT_CODE_LENGTH = 255;

export type TariffMembershipStatus = 'NOT_EVALUATED' | 'LISTED' | 'NOT_LISTED';

export function normalizeTariffProductCode(value: unknown): string {
  return normalizeSourceText(value);
}

export function isValidTariffProductCode(code: string): boolean {
  return code.length > 0 && code.length <= MAX_TARIFF_PRODUCT_CODE_LENGTH;
}

export function deriveTariffMembershipStatus(listed: boolean): 'LISTED' | 'NOT_LISTED' {
  return listed ? 'LISTED' : 'NOT_LISTED';
}

export type EpsNovedadCausal =
  | 'SOURCE_STATUS_BLOCKED'
  | 'AUTHORIZATION_EXPIRED'
  | 'DIRECTION_PENDING'
  | 'DIRECTION_QUERY_ERROR'
  | 'PRODUCT_NOT_IN_TARIFF_ANNEX';

export const epsNovedadCausalMessages: Record<EpsNovedadCausal, string> = {
  SOURCE_STATUS_BLOCKED: 'El estado de la autorización en la fuente no habilita el registro.',
  AUTHORIZATION_EXPIRED: 'La vigencia de la autorización está vencida.',
  DIRECTION_PENDING: 'Direccionamiento MIPRES pendiente de confirmación.',
  DIRECTION_QUERY_ERROR: 'No fue posible determinar el direccionamiento MIPRES.',
  PRODUCT_NOT_IN_TARIFF_ANNEX: 'Producto no incluido en el Anexo Tarifario',
};

export type EpsNovedadInput = Readonly<{
  enablementStatus: 'ENABLED' | 'BLOCKED_SOURCE_STATUS';
  operationStatus:
    | 'BLOCKED'
    | 'READY_TO_DISPENSE'
    | 'DISPENSATION_REPORTED'
    | 'DISPENSED'
    | 'EXPIRED'
    | null;
  coverageType: 'PBS' | 'NO_PBS';
  directionStatus: 'NOT_APPLICABLE' | 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR';
  tariffMembershipStatus: TariffMembershipStatus;
  fechaFinalVigencia?: unknown;
  today?: string;
}>;

/**
 * Causales activas de un registro que NO alcanzó READY_TO_DISPENSE. Un
 * registro puede acumular varias causales simultáneas (ej.
 * AUTHORIZATION_EXPIRED + PRODUCT_NOT_IN_TARIFF_ANNEX). Los estados avanzados
 * (DISPENSATION_REPORTED/DISPENSED) implican que el registro ya superó las
 * validaciones; sus causales históricas quedaron resueltas.
 */
export function deriveEpsNovedadCausales(input: EpsNovedadInput): EpsNovedadCausal[] {
  if (
    input.operationStatus === 'READY_TO_DISPENSE' ||
    input.operationStatus === 'DISPENSATION_REPORTED' ||
    input.operationStatus === 'DISPENSED'
  ) {
    return [];
  }
  const causales: EpsNovedadCausal[] = [];
  if (input.enablementStatus === 'BLOCKED_SOURCE_STATUS') {
    causales.push('SOURCE_STATUS_BLOCKED');
  }
  const vigencia = parseVigenciaDate(input.fechaFinalVigencia);
  const expired =
    input.operationStatus === 'EXPIRED' ||
    (input.today !== undefined && vigencia !== null && input.today > vigencia);
  if (expired) causales.push('AUTHORIZATION_EXPIRED');
  if (input.coverageType === 'NO_PBS' && input.directionStatus === 'PENDING') {
    causales.push('DIRECTION_PENDING');
  }
  if (input.coverageType === 'NO_PBS' && input.directionStatus === 'QUERY_ERROR') {
    causales.push('DIRECTION_QUERY_ERROR');
  }
  if (input.tariffMembershipStatus === 'NOT_LISTED') {
    causales.push('PRODUCT_NOT_IN_TARIFF_ANNEX');
  }
  return causales;
}
