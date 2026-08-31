/**
 * Puerto y reglas puras de la integración MIPRES (Fase 3, solo lectura).
 * El dominio no conoce endpoints, nombres de campos oficiales ni HTTP:
 * eso vive exclusivamente en el adaptador (ADR-008, DEC-013).
 */

export type MipresDirection = Readonly<{
  externalId: string;
  directionId: string;
  prescriptionNumber: string;
  technologyType: string;
  technologyConsecutive: string;
  /** Fecha máxima de entrega en ISO YYYY-MM-DD. */
  maximumDeliveryDate: string;
  externalStatus: string;
  annulled: boolean;
}>;

export type MipresQueryResult = Readonly<{
  directions: MipresDirection[];
  /** Código HTTP del proveedor cuando exista respuesta; null ante fallo de red/timeout. */
  httpStatus: number | null;
  /** Evidencia técnica con tokens ya redactados por el adaptador. */
  rawPayload: unknown;
}>;

export type MipresQueryOutcome = 'PENDING' | 'CONFIRMED';

/**
 * Puerto del dominio hacia MIPRES. DEC-013: exclusivamente lectura de
 * direccionamientos por número de prescripción.
 */
export interface MipresPort {
  getDirectionsByPrescription(prescriptionNumber: string): Promise<MipresQueryResult>;
}

export const MIPRES_VIGENCIA_RULE_VERSION = 'F3-MIPRES-1';

/** Fecha calendario de la zona America/Bogota para un instante dado. */
export function currentBogotaDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export type MipresVigenciaEvaluation = Readonly<{
  outcome: MipresQueryOutcome;
  hasCurrent: boolean;
  directionCount: number;
  ruleVersion: string;
}>;

/**
 * DEC-001/DEC-013: un direccionamiento es vigente solo cuando no está anulado
 * y current_date(America/Bogota) < FecMaxEnt. La igualdad no es válida.
 */
export function evaluateMipresVigencia(
  directions: readonly MipresDirection[],
  todayBogota: string,
): MipresVigenciaEvaluation {
  const hasCurrent = directions.some(
    (direction) => !direction.annulled && todayBogota < direction.maximumDeliveryDate,
  );
  return {
    outcome: hasCurrent ? 'CONFIRMED' : 'PENDING',
    hasCurrent,
    directionCount: directions.length,
    ruleVersion: MIPRES_VIGENCIA_RULE_VERSION,
  };
}
