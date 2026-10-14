/** Marker local, independiente de la fuente EPS. */
export const AUTHORIZATION_ANNULMENT_EVIDENCE_KEY = '__mtdAnnulment' as const;

export function isAuthorizationAnnulled(sourceData: unknown): boolean {
  return Boolean(
    sourceData &&
    typeof sourceData === 'object' &&
    !Array.isArray(sourceData) &&
    AUTHORIZATION_ANNULMENT_EVIDENCE_KEY in sourceData &&
    (sourceData as Record<string, unknown>)[AUTHORIZATION_ANNULMENT_EVIDENCE_KEY],
  );
}

export type AuthorizationAnnulmentBlock =
  | 'AUTHORIZATION_ALREADY_ANNULLED'
  | 'AUTHORIZATION_ALREADY_ATTENDED'
  | null;

/** Tener OC o una reserva NO impide anular; cualquier consumo real sí. */
export function authorizationAnnulmentBlock(input: Readonly<{
  alreadyAnnulled: boolean;
  hasFulfillment: boolean;
  hasConfirmedApplication: boolean;
  hasInventoryConsumption: boolean;
}>): AuthorizationAnnulmentBlock {
  if (input.alreadyAnnulled) return 'AUTHORIZATION_ALREADY_ANNULLED';
  if (input.hasFulfillment || input.hasConfirmedApplication || input.hasInventoryConsumption) {
    return 'AUTHORIZATION_ALREADY_ATTENDED';
  }
  return null;
}
