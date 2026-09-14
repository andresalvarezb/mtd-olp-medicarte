export type PatientApplicationAuditStatus = 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export function canTransitionPatientApplicationAudit(
  from: PatientApplicationAuditStatus,
  to: PatientApplicationAuditStatus,
): boolean {
  return from === 'IN_REVIEW' && (to === 'APPROVED' || to === 'REJECTED');
}

export function isTerminalPatientApplicationAudit(status: PatientApplicationAuditStatus): boolean {
  return status === 'APPROVED' || status === 'REJECTED';
}
