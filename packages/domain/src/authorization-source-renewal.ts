import { normalizeAuthorizationOperationalDate } from './authorization-operational-window';

/** Proveniencia dentro de source_data, independiente de las columnas del XLSX. */
export const AUTHORIZATION_16_RENEWAL_EVIDENCE_KEY = '__authorizationRenewal16To5' as const;

export type Authorization16RenewalDecision = Readonly<{
  effectiveSourceStatus: string;
  outcome: 'PROMOTED' | 'PRESERVED' | 'STALE_RELOAD' | 'UNCHANGED';
}>;

/**
 * Esta regla SOLO resuelve el estado fuente efectivo: NO altera los gates de AT,
 * cantidad mínima, PBS/NO PBS, MIPRES, vigencia ni estado operacional.
 * La condición de fecha es una ampliación real hacia una fecha >= hoy Bogotá.
 */
export function decideAuthorization16Renewal(input: Readonly<{
  storedSourceStatus: unknown;
  incomingSourceStatus: unknown;
  previousValidityEndDate: string | null | undefined;
  nextValidityEndDate: string | null | undefined;
  todayBogota: string;
  previouslyRenewed?: boolean;
}>): Authorization16RenewalDecision {
  const text = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const stored = text(input.storedSourceStatus);
  const incoming = text(input.incomingSourceStatus);
  const previous = normalizeAuthorizationOperationalDate(input.previousValidityEndDate);
  const next = normalizeAuthorizationOperationalDate(input.nextValidityEndDate);
  const today = normalizeAuthorizationOperationalDate(input.todayBogota);
  if (!today || today !== input.todayBogota) throw new Error('INVALID_BOGOTA_DATE');

  if (stored === '16' && incoming === '16' && previous && next && next > previous && next >= today) {
    return { effectiveSourceStatus: '5', outcome: 'PROMOTED' };
  }

  // Una nueva carga que repite el 16 de origen no debe deshacer una renovación.
  // Una fecha anterior a la ya renovada requiere intervención explícita.
  if (stored === '5' && incoming === '16' && input.previouslyRenewed) {
    if (!previous || !next || next < previous) {
      return { effectiveSourceStatus: '5', outcome: 'STALE_RELOAD' };
    }
    return { effectiveSourceStatus: '5', outcome: 'PRESERVED' };
  }

  return { effectiveSourceStatus: incoming, outcome: 'UNCHANGED' };
}
