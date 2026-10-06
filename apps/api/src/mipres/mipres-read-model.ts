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
  | 'MANUALLY_DISABLED'
  | 'MIPRES_COVERAGE_UNRESOLVED';

export type MipresManualUnlockMode =
  | 'NATURALLY_ENABLED'
  | 'PENDING_MANUAL_OVERRIDE'
  | 'NOT_ALLOWED';

export function resolveMipresManualUnlockEligibility(
  input: Readonly<{
    authorizationState: MipresAuthorizationState;

    operationalWindow: MipresOperationalWindow;

    enablementStatus: string;

    tariffMembershipStatus: string;

    coverageType: string | null | undefined;

    directionStatus: string | null | undefined;
  }>,
): Readonly<{
  allowed: boolean;

  mode: MipresManualUnlockMode;
}> {
  /*
   * Habilitación AUTO y bloqueo MIPRES son dimensiones
   * independientes.
   *
   * ENABLED:
   *   puede desbloquear MIPRES.
   *
   * PENDING:
   *   puede desbloquear MIPRES manualmente.
   *   La AUTO continúa Pendiente hasta que sus condiciones
   *   naturales permitan pasar a Habilitada.
   *
   * DISABLED:
   *   no puede desbloquear MIPRES porque existe un bloqueo
   *   duro de la AUTO.
   */

  if (input.authorizationState === 'DISABLED') {
    return {
      allowed: false,
      mode: 'NOT_ALLOWED',
    };
  }

  if (input.authorizationState === 'ENABLED') {
    return {
      allowed: true,
      mode: 'NATURALLY_ENABLED',
    };
  }

  return {
    allowed: true,
    mode: 'PENDING_MANUAL_OVERRIDE',
  };
}

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

export function parsePositiveInteger(
  raw: unknown,
): number | null {
  const value =
    typeof raw === 'number'
    ||
    typeof raw === 'string'
      ? String(raw).trim()
      : '';

  if (
    !/^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$/.test(
      value,
    )
  ) {
    return null;
  }

  const number =
    Number(value);

  return (
    Number.isSafeInteger(number)
    &&
    number > 0
  )
    ? number
    : null;
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
    authorizationState?:
      MipresAuthorizationState;

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
    !Number.isFinite(input.minimumQuantity)
    ||
    input.minimumQuantity <= 0;

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

  /*
   * Habilitación y MIPRES son dimensiones independientes.
   *
   * directionStatus es evidencia MIPRES y no participa
   * en el cálculo de Habilitación de la AUTO.
   */
  const authorizationPending =
    !authorizationDisabled &&
    (input.tariffMembershipStatus !== 'LISTED' ||
      input.operationalWindow === 'OUTSIDE_HORIZON');

  const derivedAuthorizationState:
    MipresAuthorizationState =
      authorizationDisabled
        ? 'DISABLED'
        : authorizationPending
          ? 'PENDING'
          : 'ENABLED';

  /*
   * La Habilitación proveniente de Autorizaciones
   * es autoritativa.
   *
   * MIPRES no debe reinterpretarla.
   */
  const authorizationState =
    input.authorizationState
    ??
    derivedAuthorizationState;

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
   * Gate MIPRES.
   *
   * PBS:
   *   no requiere validación manual MIPRES.
   *
   * NO_PBS:
   *   inicia bloqueada y únicamente una decisión manual
   *   MANUALLY_ENABLED permite continuar.
   *
   * directionStatus queda como evidencia/trazabilidad.
   */
  const isPbs = input.coverageType === 'PBS';
  const isNoPbs = input.coverageType === 'NO_PBS';

  const mipresState: MipresManualGateState =
    isPbs || (isNoPbs && decision === 'MANUALLY_ENABLED')
      ? 'UNLOCKED'
      : 'LOCKED';

  if (isNoPbs && decision === 'PENDING_MANUAL_ENABLEMENT') {
    blockedReasons.push('PENDING_MANUAL_ENABLEMENT');
  }

  if (isNoPbs && decision === 'MANUALLY_DISABLED') {
    blockedReasons.push('MANUALLY_DISABLED');
  }

  /*
   * Si todavía no sabemos si la AUTO es PBS o NO PBS,
   * no permitimos continuar. Esto es un diagnóstico interno,
   * no un tercer estado de MIPRES.
   */
  if (!isPbs && !isNoPbs) {
    blockedReasons.push('MIPRES_COVERAGE_UNRESOLVED');
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
