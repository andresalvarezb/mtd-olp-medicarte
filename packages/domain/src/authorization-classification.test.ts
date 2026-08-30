import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationKey,
  deriveAuthorizationClassification,
  deriveCoverageType,
  deriveDirectionStatus,
  deriveEnablementStatus,
  deriveOperationStatus,
  derivePrescripcion,
  normalizeSourceText,
} from './authorization-classification';

describe('authorization classification', () => {
  it('normalizes source text with exact technical normalization', () => {
    expect(normalizeSourceText('  medicamentos   no pos ')).toBe('MEDICAMENTOS NO POS');
    expect(normalizeSourceText('Medicamentos no pos - alto costo')).toBe(
      'MEDICAMENTOS NO POS - ALTO COSTO',
    );
  });

  it('uses presence of No.PRESCRIPCION for PBS and NO_PBS', () => {
    expect(deriveCoverageType('')).toBe('PBS');
    expect(deriveCoverageType('20260915123')).toBe('NO_PBS');
  });

  it('derives the MIPRES prescription by removing the last three digits', () => {
    expect(derivePrescripcion(' 20260000000000000000123 ')).toEqual({
      normalized: '20260000000000000000123',
      derived: '20260000000000000000',
    });
    expect(derivePrescripcion('')).toEqual({ normalized: '', derived: '' });
    expect(derivePrescripcion(null)).toEqual({ normalized: '', derived: '' });
    expect(derivePrescripcion(20260915123)).toEqual({
      normalized: '20260915123',
      derived: '20260915',
    });
  });

  it('rejects prescripcion values that cannot be truncated or are not numeric', () => {
    expect(derivePrescripcion('ABC')).toBeNull();
    expect(derivePrescripcion('12.34')).toBeNull();
    expect(derivePrescripcion('2026-09-15')).toBeNull();
    expect(derivePrescripcion('123')).toBeNull();
    expect(derivePrescripcion('12 34')).toBeNull();
  });

  it('derives enablement and direction without external calls', () => {
    expect(deriveEnablementStatus(5)).toBe('ENABLED');
    expect(deriveEnablementStatus('4')).toBe('BLOCKED_SOURCE_STATUS');
    expect(deriveDirectionStatus('PBS')).toBe('NOT_APPLICABLE');
    expect(deriveDirectionStatus('NO_PBS')).toBe('PENDING');
  });

  it('derives a safe operational status from readiness dimensions', () => {
    expect(
      deriveOperationStatus({
        enablementStatus: 'ENABLED',
        coverageType: 'PBS',
        directionStatus: 'NOT_APPLICABLE',
      }),
    ).toBe('READY_TO_DISPENSE');
    expect(
      deriveOperationStatus({
        enablementStatus: 'ENABLED',
        coverageType: 'NO_PBS',
        directionStatus: 'CONFIRMED',
      }),
    ).toBe('READY_TO_DISPENSE');
    expect(
      deriveOperationStatus({
        enablementStatus: 'BLOCKED_SOURCE_STATUS',
        coverageType: 'PBS',
        directionStatus: 'NOT_APPLICABLE',
      }),
    ).toBe('BLOCKED');
    expect(
      deriveOperationStatus({
        enablementStatus: 'ENABLED',
        coverageType: 'NO_PBS',
        directionStatus: 'PENDING',
      }),
    ).toBe('BLOCKED');
  });

  it('builds a stable, delimited identity key', () => {
    expect(buildAuthorizationKey(' a-1 ', ' med-2 ')).toEqual({
      numeroAutorizacion: 'A-1',
      codigoMedicamento: 'MED-2',
      authorizationKey: 'A-1:MED-2',
    });
    expect(buildAuthorizationKey('', 'MED-2')).toBeNull();
  });

  it('escapes the delimiter so distinct pairs never collide', () => {
    const first = buildAuthorizationKey('A:B', 'C')?.authorizationKey;
    const second = buildAuthorizationKey('A', 'B:C')?.authorizationKey;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it('rejects oversized identity components instead of producing an unpersistable key', () => {
    expect(buildAuthorizationKey('X'.repeat(251), 'MED-2')).toBeNull();
  });

  it('returns the complete phase two classification', () => {
    expect(
      deriveAuthorizationClassification({
        numeroAutorizacion: 'a-1',
        codigoComercial: 'm-1',
        noPrescripcion: 20260915123,
        estadoAutorizacion: 5,
      }),
    ).toMatchObject({
      coverageType: 'NO_PBS',
      enablementStatus: 'ENABLED',
      directionStatus: 'PENDING',
      prescripcionNormalized: '20260915123',
      noPrescripcion: '20260915',
      operationStatus: null,
    });
    expect(
      deriveAuthorizationClassification({
        numeroAutorizacion: 'a-1',
        codigoComercial: 'm-1',
        noPrescripcion: '',
        estadoAutorizacion: 5,
      }),
    ).toMatchObject({
      coverageType: 'PBS',
      enablementStatus: 'ENABLED',
      directionStatus: 'NOT_APPLICABLE',
      prescripcionNormalized: '',
      noPrescripcion: '',
      operationStatus: null,
    });
  });

  it('rejects invalid prescripcion formats instead of classifying', () => {
    expect(
      deriveAuthorizationClassification({
        numeroAutorizacion: 'a-1',
        codigoComercial: 'm-1',
        noPrescripcion: '123',
        estadoAutorizacion: 5,
      }),
    ).toBeNull();
  });
});
