import { describe, expect, it } from 'vitest';
import {
  canApproveAuditReview,
  canDecideAuditReview,
  canStartAuditReview,
  deriveAdmissionStatus,
} from './audit';

describe('canStartAuditReview', () => {
  it('solo habilita revisión desde READY o REJECTED', () => {
    expect(canStartAuditReview('READY')).toBe(true);
    expect(canStartAuditReview('REJECTED')).toBe(true);
  });

  it('no permite iniciar revisión en otros estados', () => {
    for (const status of ['NOT_STARTED', 'IN_REVIEW', 'APPROVED'] as const) {
      expect(canStartAuditReview(status)).toBe(false);
    }
  });
});

describe('canDecideAuditReview', () => {
  it('solo una revisión en curso puede decidirse', () => {
    expect(canDecideAuditReview('IN_REVIEW')).toBe(true);
    expect(canDecideAuditReview('APPROVED')).toBe(false);
    expect(canDecideAuditReview('REJECTED')).toBe(false);
  });
});

describe('canApproveAuditReview', () => {
  it('permite PBS y NO PBS con direccionamiento confirmado', () => {
    expect(canApproveAuditReview({ coverageType: 'PBS', directionStatus: 'NOT_APPLICABLE' })).toBe(true);
    expect(canApproveAuditReview({ coverageType: 'NO_PBS', directionStatus: 'CONFIRMED' })).toBe(true);
  });

  it('bloquea NO PBS mientras MIPRES este pendiente o tenga error', () => {
    expect(canApproveAuditReview({ coverageType: 'NO_PBS', directionStatus: 'PENDING' })).toBe(false);
    expect(canApproveAuditReview({ coverageType: 'NO_PBS', directionStatus: 'QUERY_ERROR' })).toBe(false);
  });
});

describe('deriveAdmissionStatus', () => {
  it('APPROVED deriva READY; ningún otro estado lo hace', () => {
    expect(
      deriveAdmissionStatus({ auditStatus: 'APPROVED', currentAdmissionStatus: 'NOT_READY' }),
    ).toBe('READY');
    for (const auditStatus of ['NOT_STARTED', 'READY', 'IN_REVIEW', 'REJECTED'] as const) {
      expect(deriveAdmissionStatus({ auditStatus, currentAdmissionStatus: 'NOT_READY' })).toBe(
        'NOT_READY',
      );
    }
  });

  it('nunca edita por UI: solo la regla de dominio produce READY', () => {
    expect(
      deriveAdmissionStatus({ auditStatus: 'READY', currentAdmissionStatus: 'NOT_READY' }),
    ).toBe('NOT_READY');
  });

  it('READY solo expresa "listo para admisión"; no existen estados de handoff en el núcleo', () => {
    expect(
      deriveAdmissionStatus({ auditStatus: 'APPROVED', currentAdmissionStatus: 'READY' }),
    ).toBe('READY');
  });
});
