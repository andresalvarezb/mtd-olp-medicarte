import { normalizeMipresManualDecision } from '@authorization/domain';

export type MipresReadState = 'OPERABLE' | 'BLOCKED';

export type MipresAuthorizationState = 'ENABLED' | 'PENDING' | 'DISABLED';

export type MipresManualGateState = 'LOCKED' | 'UNLOCKED';

export type MipresOperationalWindow = 'IN_WINDOW' | 'EXPIRED' | 'OUTSIDE_HORIZON' | 'INVALID_DATE';

export type MipresBlockedReason =
  | 'SOURCE_BLOCKED'
  | 'TARIFF_NOT_LISTED'
  | 'INVALID_QUANTITY'
  | 'BELOW_MINIMUM_QUANTITY'
  | 'OPERATIONAL_WINDOW_BLOCKED'
  | 'PENDING_MANUAL_ENABLEMENT'
  | 'MANUALLY_DISABLED';

export function normalizeSourceDate(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const value = raw.trim();

  let iso: string;

  if (/^[0-9]{8}$/.test(value)) {
    iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  } else if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(value)) {
    iso = value.slice(0, 10);
  } else {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);

  const month = Number(match[2]);

  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return iso;
}

export function parsePositiveInteger(raw: unknown): number | null {
  const value = typeof raw === 'number' || typeof raw === 'string' ? String(raw).trim() : '';

  if (!/^[1-9][0-9]*$/.test(value)) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) ? number : null;
}

export function resolveOperationalWindow(
  input: Readonly<{
    assignmentDate: string | null;

    validityEndDate: string | null;

    today: string;

    horizon: string;
  }>,
): MipresOperationalWindow {
  if (!input.assignmentDate || !input.validityEndDate) {
    return 'INVALID_DATE';
  }

  if (input.validityEndDate < input.today) {
    return 'EXPIRED';
  }

  if (input.assignmentDate > input.horizon) {
    return 'OUTSIDE_HORIZON';
  }

  return 'IN_WINDOW';
}

export function resolveMipresReadState(
  input: Readonly<{
    enablementStatus: string;

    tariffMembershipStatus: string;

    coverageType: string | null | undefined;

    directionStatus: string | null | undefined;

    manualDecision: string | null | undefined;

    quantity: number | null;

    minimumQuantity: number;

    operationalWindow: MipresOperationalWindow;
  }>,
) {
  /*
   * Habilitación natural de la AUTO.
   *
   * No incluye la decisión manual MIPRES.
   * Se usa para decidir si el bloqueo MIPRES
   * puede ser levantado.
   */
  const invalidMinimumQuantity =
    !Number.isSafeInteger(input.minimumQuantity) || input.minimumQuantity <= 0;

  /*
   * Habilitación natural de la AUTO.
   *
   * NO depende de mipresManualDecision.
   *
   * Dimensiones:
   * - estado fuente;
   * - Anexo Tarifario;
   * - cantidad;
   * - cobertura/direccionamiento;
   * - vigencia.
   */
  const authorizationDisabled =
    input.enablementStatus !== 'ENABLED' ||
    input.tariffMembershipStatus === 'NOT_LISTED' ||
    input.quantity === null ||
    invalidMinimumQuantity ||
    (input.quantity !== null && input.quantity < input.minimumQuantity) ||
    input.operationalWindow === 'EXPIRED' ||
    input.operationalWindow === 'INVALID_DATE';

  const authorizationCoveragePending =
    (input.coverageType === 'NO_PBS' && input.directionStatus !== 'CONFIRMED') ||
    (input.coverageType === 'PBS' && input.directionStatus !== 'NOT_APPLICABLE') ||
    (input.coverageType !== 'PBS' && input.coverageType !== 'NO_PBS');

  const authorizationPending =
    !authorizationDisabled &&
    (input.tariffMembershipStatus !== 'LISTED' ||
      input.operationalWindow === 'OUTSIDE_HORIZON' ||
      authorizationCoveragePending);

  const authorizationState: MipresAuthorizationState = authorizationDisabled
    ? 'DISABLED'
    : authorizationPending
      ? 'PENDING'
      : 'ENABLED';

  const blockedReasons: MipresBlockedReason[] = [];

  if (input.enablementStatus !== 'ENABLED') {
    blockedReasons.push('SOURCE_BLOCKED');
  }

  if (input.tariffMembershipStatus !== 'LISTED') {
    blockedReasons.push('TARIFF_NOT_LISTED');
  }

  if (input.quantity === null) {
    blockedReasons.push('INVALID_QUANTITY');
  } else if (input.quantity < input.minimumQuantity) {
    blockedReasons.push('BELOW_MINIMUM_QUANTITY');
  }

  if (input.operationalWindow !== 'IN_WINDOW') {
    blockedReasons.push('OPERATIONAL_WINDOW_BLOCKED');
  }

  const decision = normalizeMipresManualDecision(input.manualDecision);

  /*
   * Estado exclusivamente del bloqueo manual MIPRES.
   */
  const mipresState: MipresManualGateState =
    decision === 'MANUALLY_ENABLED' ? 'UNLOCKED' : 'LOCKED';

  if (decision === 'PENDING_MANUAL_ENABLEMENT') {
    blockedReasons.push('PENDING_MANUAL_ENABLEMENT');
  }

  if (decision === 'MANUALLY_DISABLED') {
    blockedReasons.push('MANUALLY_DISABLED');
  }

  return {
    state:
      authorizationState === 'ENABLED' && blockedReasons.length === 0
        ? ('OPERABLE' as const)
        : ('BLOCKED' as const),

    authorizationState,

    mipresState,

    blockedReasons,
  };
}
