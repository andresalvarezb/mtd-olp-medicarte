import { describe, expect, it } from 'vitest';
import { canDecideAuditReview, canStartAuditReview, deriveAdmissionStatus } from './audit';

describe('canStartAuditReview', () => {
  it('solo habilita revisión desde LISTO o RECHAZADO', () => {
    expect(canStartAuditReview('LISTO')).toBe(true);
    expect(canStartAuditReview('RECHAZADO')).toBe(true);
  });

  it('no permite iniciar revisión en otros estados', () => {
    for (const status of ['NO_INICIADO', 'EN_REVISION', 'APROBADO'] as const) {
      expect(canStartAuditReview(status)).toBe(false);
    }
  });
});

describe('canDecideAuditReview', () => {
  it('solo una revisión en curso puede decidirse', () => {
    expect(canDecideAuditReview('EN_REVISION')).toBe(true);
    expect(canDecideAuditReview('APROBADO')).toBe(false);
    expect(canDecideAuditReview('RECHAZADO')).toBe(false);
  });
});

describe('deriveAdmissionStatus', () => {
  it('APROBADO deriva LISTO; ningún otro estado lo hace', () => {
    expect(
      deriveAdmissionStatus({ auditStatus: 'APROBADO', currentAdmissionStatus: 'NO_LISTO' }),
    ).toBe('LISTO');
    for (const auditStatus of ['NO_INICIADO', 'LISTO', 'EN_REVISION', 'RECHAZADO'] as const) {
      expect(deriveAdmissionStatus({ auditStatus, currentAdmissionStatus: 'NO_LISTO' })).toBe(
        'NO_LISTO',
      );
    }
  });

  it('nunca edita por UI: solo la regla de dominio produce LISTO', () => {
    expect(
      deriveAdmissionStatus({ auditStatus: 'LISTO', currentAdmissionStatus: 'NO_LISTO' }),
    ).toBe('NO_LISTO');
  });

  it('LISTO solo expresa "listo para admisión"; no existen estados de handoff en el núcleo', () => {
    expect(
      deriveAdmissionStatus({ auditStatus: 'APROBADO', currentAdmissionStatus: 'LISTO' }),
    ).toBe('LISTO');
  });
});
