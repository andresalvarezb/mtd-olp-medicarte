import type { AdmissionStatus, AuditStatus } from '@authorization/contracts';

/**
 * SPEC-002/SPEC-006/ADR-009: transiciones de auditoría puramente humanas.
 * Ningún proceso automático puede producir APPROVED; la derivación
 * NOT_STARTED -> READY ocurre en operational.ts cuando existen ambas fechas.
 */
export const AUDIT_RULE_VERSION = 'F6-AUDIT-1' as const;

/** Inicio de revisión: solo READY o REJECTED (revisión posterior explícita). */
export function canStartAuditReview(auditStatus: AuditStatus): boolean {
  return auditStatus === 'READY' || auditStatus === 'REJECTED';
}

/** Una decisión (aprobar/rechazar) solo puede partir de una revisión IN_REVIEW. */
export function canDecideAuditReview(reviewStatus: 'IN_REVIEW' | 'APPROVED' | 'REJECTED'): boolean {
  return reviewStatus === 'IN_REVIEW';
}

/**
 * DEC-003/DEC-006/SPEC-006: la aprobación humana produce DISPENSED y habilita
 * la derivación de admisión. admission_status solo avanza a READY aquí; los
 * estados HANDED_OFF/COMPLETED/ERROR pertenecen al handoff de Fase 7 y nunca
 * retroceden por una reevaluación local.
 */
export function deriveAdmissionStatus(
  input: Readonly<{
    auditStatus: AuditStatus;
    currentAdmissionStatus: AdmissionStatus;
  }>,
): AdmissionStatus {
  if (
    input.currentAdmissionStatus === 'HANDED_OFF' ||
    input.currentAdmissionStatus === 'COMPLETED' ||
    input.currentAdmissionStatus === 'ERROR'
  ) {
    return input.currentAdmissionStatus;
  }
  return input.auditStatus === 'APPROVED' ? 'READY' : 'NOT_READY';
}
