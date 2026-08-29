import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationKey,
  deriveAuthorizationClassification,
  deriveCoverageType,
  deriveDirectionStatus,
  deriveEnablementStatus,
  normalizeSourceText,
} from './authorization-classification';

describe('authorization classification', () => {
  it('normalizes source text with exact technical normalization', () => {
    expect(normalizeSourceText('  medicamentos   no pos ')).toBe('MEDICAMENTOS NO POS');
    expect(normalizeSourceText('Medicamentos no pos - alto costo')).toBe(
      'MEDICAMENTOS NO POS - ALTO COSTO',
    );
  });

  it('uses exact equality for PBS and NO_PBS', () => {
    expect(deriveCoverageType('MEDICAMENTOS NO POS')).toBe('NO_PBS');
    expect(deriveCoverageType('MEDICAMENTOS NO POS - ALTO COSTO')).toBe('PBS');
    expect(deriveCoverageType('MEDICAMENTOS POS')).toBe('PBS');
  });

  it('derives enablement and direction without external calls', () => {
    expect(deriveEnablementStatus(5)).toBe('ENABLED');
    expect(deriveEnablementStatus('4')).toBe('BLOCKED_SOURCE_STATUS');
    expect(deriveDirectionStatus('PBS')).toBe('NOT_APPLICABLE');
    expect(deriveDirectionStatus('NO_PBS')).toBe('PENDING');
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
        cupsPrincipal: ' medicamentos no pos ',
        estadoAutorizacion: 5,
      }),
    ).toMatchObject({
      coverageType: 'NO_PBS',
      enablementStatus: 'ENABLED',
      directionStatus: 'PENDING',
      operationStatus: null,
    });
  });
});
