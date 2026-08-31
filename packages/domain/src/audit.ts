import type { AdmissionStatus, AuditStatus } from '@authorization/contracts';

/**
 * SPEC-002/SPEC-006/ADR-009: transiciones de auditoría puramente humanas.
 * Ningún proceso automático puede producir APROBADO; la derivación
 * NO_INICIADO -> LISTO ocurre en operational.ts cuando existen ambas fechas.
 */
export const AUDIT_RULE_VERSION = 'F6-AUDIT-1' as const;

/** Inicio de revisión: solo LISTO o RECHAZADO (revisión posterior explícita). */
export function canStartAuditReview(auditStatus: AuditStatus): boolean {
  return auditStatus === 'LISTO' || auditStatus === 'RECHAZADO';
}

/** Una decisión (aprobar/rechazar) solo puede partir de una revisión EN_REVISION. */
export function canDecideAuditReview(reviewStatus: 'EN_REVISION' | 'APROBADO' | 'RECHAZADO'): boolean {
  return reviewStatus === 'EN_REVISION';
}

/**
 * DEC-003/DEC-006/SPEC-006: la aprobación humana produce DISPENSADO y deriva
 * admission_status = LISTO ("listo para admisión"), que habilita la descarga
 * de la base para el proceso externo de admisiones. No existen estados de
 * handoff en el núcleo: el alcance de Fase 6 cierra la plataforma.
 */
export function deriveAdmissionStatus(
  input: Readonly<{
    auditStatus: AuditStatus;
    currentAdmissionStatus: AdmissionStatus;
  }>,
): AdmissionStatus {
  return input.auditStatus === 'APROBADO' ? 'LISTO' : 'NO_LISTO';
}
