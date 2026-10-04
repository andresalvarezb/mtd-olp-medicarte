/**
 * Control operacional MIPRES de MTD.
 *
 * Principios:
 *
 * 1. directionStatus conserva exclusivamente la evidencia oficial MIPRES.
 *
 * 2. Una AUTO NO_PBS/MIPRES NO queda operable automáticamente
 *    aunque exista un direccionamiento CONFIRMED.
 *
 * 3. Toda AUTO sujeta al control MIPRES parte operacionalmente en:
 *
 *      PENDING_MANUAL_ENABLEMENT
 *
 *    Esto significa:
 *
 *      "Pendiente por habilitar manualmente"
 *
 * 4. MTD puede decidir explícitamente:
 *
 *      MANUALLY_ENABLED
 *      MANUALLY_DISABLED
 *
 * 5. Restablecer una decisión manual devuelve el control a:
 *
 *      PENDING_MANUAL_ENABLEMENT
 *
 *    y NO a un modo automático.
 *
 * 6. La decisión manual solamente resuelve el criterio MIPRES.
 *    No reemplaza ni omite otras validaciones operacionales.
 */

export const MIPRES_MANUAL_DECISIONS = [
  'PENDING_MANUAL_ENABLEMENT',
  'MANUALLY_ENABLED',
  'MANUALLY_DISABLED',
] as const;

export type MipresManualDecision =
  (typeof MIPRES_MANUAL_DECISIONS)[number];

export type MipresEffectiveEligibilitySource =
  | 'NOT_APPLICABLE'
  | 'COVERAGE_NOT_APPLICABLE'
  | 'PENDING_MANUAL_ENABLEMENT'
  | 'MANUAL_ENABLE'
  | 'MANUAL_DISABLE';

export type MipresEffectiveEligibility =
  Readonly<{
    eligible: boolean;

    source:
      MipresEffectiveEligibilitySource;
  }>;


/**
 * Compatibilidad defensiva:
 *
 * - null
 * - undefined
 * - valores históricos/desconocidos
 *
 * nunca habilitan una AUTO MIPRES.
 *
 * Se normalizan al estado seguro:
 *
 * PENDING_MANUAL_ENABLEMENT
 */
export function normalizeMipresManualDecision(
  value:
    string |
    null |
    undefined,
): MipresManualDecision {
  if (
    value ===
      'PENDING_MANUAL_ENABLEMENT' ||
    value ===
      'MANUALLY_ENABLED' ||
    value ===
      'MANUALLY_DISABLED'
  ) {
    return value;
  }

  return 'PENDING_MANUAL_ENABLEMENT';
}


/**
 * Resuelve EXCLUSIVAMENTE el criterio operacional MIPRES.
 *
 * NO evalúa:
 *
 * - estado fuente de la AUTO;
 * - Anexo Tarifario;
 * - cantidad mínima;
 * - cantidad autorizada;
 * - ventana operacional;
 * - inventario;
 * - OC;
 * - allocation;
 * - fulfillment;
 * - cierre de la autorización.
 *
 * directionStatus continúa representando evidencia oficial.
 *
 * La evidencia oficial CONFIRMED NO habilita por sí sola.
 */
export function evaluateEffectiveMipresEligibility(
  input:
    Readonly<{
      coverageType:
        string |
        null |
        undefined;

      directionStatus:
        string |
        null |
        undefined;

      manualDecision?:
        string |
        null;
    }>,
): MipresEffectiveEligibility {
  /*
   * PBS no utiliza el control operacional MIPRES.
   *
   * Se conserva la regla histórica:
   * PBS debe estar marcado como NOT_APPLICABLE.
   */
  if (
    input.coverageType ===
      'PBS'
  ) {
    return {
      eligible:
        input.directionStatus ===
        'NOT_APPLICABLE',

      source:
        'NOT_APPLICABLE',
    };
  }


  /*
   * Coberturas todavía no clasificadas no pueden utilizar
   * una decisión manual MIPRES para volverse operables.
   */
  if (
    input.coverageType !==
      'NO_PBS'
  ) {
    return {
      eligible:
        false,

      source:
        'COVERAGE_NOT_APPLICABLE',
    };
  }


  const manualDecision =
    normalizeMipresManualDecision(
      input.manualDecision,
    );


  /*
   * Una inhabilitación explícita MTD siempre bloquea
   * el criterio MIPRES, independientemente de la
   * evidencia externa existente.
   */
  if (
    manualDecision ===
      'MANUALLY_DISABLED'
  ) {
    return {
      eligible:
        false,

      source:
        'MANUAL_DISABLE',
    };
  }


  /*
   * Una habilitación explícita MTD satisface solamente
   * el criterio MIPRES.
   *
   * No declara ni modifica directionStatus.
   */
  if (
    manualDecision ===
      'MANUALLY_ENABLED'
  ) {
    return {
      eligible:
        true,

      source:
        'MANUAL_ENABLE',
    };
  }


  /*
   * Estado inicial y estado al restablecer una decisión.
   *
   * Incluso con:
   *
   * directionStatus = CONFIRMED
   *
   * la autorización continúa bloqueada hasta que MTD
   * la habilite explícitamente.
   */
  return {
    eligible:
      false,

    source:
      'PENDING_MANUAL_ENABLEMENT',
  };
}
