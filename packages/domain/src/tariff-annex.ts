import { normalizeSourceText, parseVigenciaDate } from './authorization-classification';

/**
 * SPEC-014 / ADR-024: el Anexo Tarifario define los códigos de producto
 * válidos para continuar la dispensación. La llave de comparación es
 * `authorization_items.codigo_medicamento` (COD_COMERCIAL normalizado) contra
 * `tariff_annex_products.codigo_producto` (misma normalización técnica).
 */
export const TARIFF_ANNEX_RULE_VERSION = 'TARIFF-ANNEX-1';

export const MAX_TARIFF_PRODUCT_CODE_LENGTH = 255;

export type TariffMembershipStatus = 'NO_EVALUADO' | 'LISTADO' | 'NO_LISTADO';

/** Misma normalización técnica de la llave de negocio (trim, mayúsculas, espacios). */
export function normalizeTariffProductCode(value: unknown): string {
  return normalizeSourceText(value);
}

export function isValidTariffProductCode(code: string): boolean {
  return code.length > 0 && code.length <= MAX_TARIFF_PRODUCT_CODE_LENGTH;
}

export function deriveTariffMembershipStatus(listed: boolean): 'LISTADO' | 'NO_LISTADO' {
  return listed ? 'LISTADO' : 'NO_LISTADO';
}

// ---------------------------------------------------------------------------
// Novedades EPS: causales estables derivables de las dimensiones del ítem.
// Un registro puede acumular varias causales simultáneas.
// ---------------------------------------------------------------------------

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
  enablementStatus: 'HABILITADO' | 'BLOQUEADO_POR_ESTADO_ORIGEN';
  operationStatus: 'BLOQUEADO' | 'LISTO_PARA_DISPENSAR' | 'DISPENSACION_REPORTADA' | 'DISPENSADO' | 'VENCIDO' | null;
  coverageType: 'PBS' | 'NO_PBS';
  directionStatus: 'NO_APLICA' | 'PENDIENTE' | 'CONFIRMADO' | 'ERROR_DE_CONSULTA';
  tariffMembershipStatus: TariffMembershipStatus;
  fechaFinalVigencia?: unknown;
  today?: string;
}>;

/**
 * Causales activas de un registro que NO alcanzó LISTO_PARA_DISPENSAR. Conserva
 * todas las novedades aplicables (ej. AUTHORIZATION_EXPIRED +
 * PRODUCT_NOT_IN_TARIFF_ANNEX); la presencia del estado operativo final
 * (DISPENSACION_REPORTADA/DISPENSADO) implica que el registro avanzó y sus
 * novedades históricas ya fueron resueltas.
 */
export function deriveEpsNovedadCausales(input: EpsNovedadInput): EpsNovedadCausal[] {
  if (
    input.operationStatus === 'LISTO_PARA_DISPENSAR' ||
    input.operationStatus === 'DISPENSACION_REPORTADA' ||
    input.operationStatus === 'DISPENSADO'
  ) {
    return [];
  }
  const causales: EpsNovedadCausal[] = [];
  if (input.enablementStatus === 'BLOQUEADO_POR_ESTADO_ORIGEN') {
    causales.push('SOURCE_STATUS_BLOCKED');
  }
  const vigencia = parseVigenciaDate(input.fechaFinalVigencia);
  const expired =
    input.operationStatus === 'VENCIDO' ||
    (input.today !== undefined && vigencia !== null && input.today > vigencia);
  if (expired) causales.push('AUTHORIZATION_EXPIRED');
  if (input.coverageType === 'NO_PBS' && input.directionStatus === 'PENDIENTE') {
    causales.push('DIRECTION_PENDING');
  }
  if (input.coverageType === 'NO_PBS' && input.directionStatus === 'ERROR_DE_CONSULTA') {
    causales.push('DIRECTION_QUERY_ERROR');
  }
  if (input.tariffMembershipStatus === 'NO_LISTADO') {
    causales.push('PRODUCT_NOT_IN_TARIFF_ANNEX');
  }
  return causales;
}
