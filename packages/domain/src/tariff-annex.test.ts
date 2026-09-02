import { describe, expect, it } from 'vitest';
import {
  MAX_TARIFF_PRODUCT_CODE_LENGTH,
  deriveEpsNovedadCausales,
  deriveTariffMembershipStatus,
  epsNovedadCausalMessages,
  isValidTariffProductCode,
  normalizeTariffProductCode,
} from './tariff-annex';

describe('tariff annex domain', () => {
  it('normalizes product codes with the same rule as COD_COMERCIAL', () => {
    expect(normalizeTariffProductCode(' abc 123 ')).toBe('ABC 123');
    expect(normalizeTariffProductCode('cod-001')).toBe('COD-001');
    expect(normalizeTariffProductCode(null)).toBe('');
    expect(normalizeTariffProductCode(undefined)).toBe('');
    expect(normalizeTariffProductCode(42)).toBe('42');
  });

  it('validates product code shape', () => {
    expect(isValidTariffProductCode('ABC001')).toBe(true);
    expect(isValidTariffProductCode('')).toBe(false);
    expect(isValidTariffProductCode('X'.repeat(MAX_TARIFF_PRODUCT_CODE_LENGTH + 1))).toBe(false);
    expect(isValidTariffProductCode('X'.repeat(MAX_TARIFF_PRODUCT_CODE_LENGTH))).toBe(true);
  });

  it('derives membership status from listing', () => {
    expect(deriveTariffMembershipStatus(true)).toBe('LISTED');
    expect(deriveTariffMembershipStatus(false)).toBe('NOT_LISTED');
  });

  it('returns no causales for advanced operational states', () => {
    const base = {
      enablementStatus: 'ENABLED',
      coverageType: 'PBS',
      directionStatus: 'NOT_APPLICABLE',
      tariffMembershipStatus: 'LISTED',
    } as const;
    expect(deriveEpsNovedadCausales({ ...base, operationStatus: 'READY_TO_DISPENSE' })).toEqual([]);
    expect(
      deriveEpsNovedadCausales({ ...base, operationStatus: 'DISPENSATION_REPORTED' }),
    ).toEqual([]);
    expect(deriveEpsNovedadCausales({ ...base, operationStatus: 'DISPENSED' })).toEqual([]);
  });

  it('accumulates multiple active causales for blocked records', () => {
    const causales = deriveEpsNovedadCausales({
      enablementStatus: 'ENABLED',
      operationStatus: 'BLOCKED',
      coverageType: 'NO_PBS',
      directionStatus: 'PENDING',
      tariffMembershipStatus: 'NOT_LISTED',
      fechaFinalVigencia: '20200101',
      today: '2026-01-01',
    });
    expect(causales).toContain('AUTHORIZATION_EXPIRED');
    expect(causales).toContain('DIRECTION_PENDING');
    expect(causales).toContain('PRODUCT_NOT_IN_TARIFF_ANNEX');
  });

  it('flags source status and query errors as independent causales', () => {
    expect(
      deriveEpsNovedadCausales({
        enablementStatus: 'BLOCKED_SOURCE_STATUS',
        operationStatus: 'BLOCKED',
        coverageType: 'PBS',
        directionStatus: 'NOT_APPLICABLE',
        tariffMembershipStatus: 'LISTED',
      }),
    ).toEqual(['SOURCE_STATUS_BLOCKED']);
    expect(
      deriveEpsNovedadCausales({
        enablementStatus: 'ENABLED',
        operationStatus: 'BLOCKED',
        coverageType: 'NO_PBS',
        directionStatus: 'QUERY_ERROR',
        tariffMembershipStatus: 'LISTED',
      }),
    ).toEqual(['DIRECTION_QUERY_ERROR']);
  });

  it('treats expired operation status as expired regardless of vigencia input', () => {
    expect(
      deriveEpsNovedadCausales({
        enablementStatus: 'ENABLED',
        operationStatus: 'EXPIRED',
        coverageType: 'PBS',
        directionStatus: 'NOT_APPLICABLE',
        tariffMembershipStatus: 'LISTED',
      }),
    ).toEqual(['AUTHORIZATION_EXPIRED']);
  });

  it('exposes a stable human message for the tariff causal', () => {
    expect(epsNovedadCausalMessages.PRODUCT_NOT_IN_TARIFF_ANNEX).toBe(
      'Producto no incluido en el Anexo Tarifario',
    );
  });

  it('does not treat descriptions or approximate codes as membership', () => {
    const annex = new Set(['MED-001']);
    expect(annex.has(normalizeTariffProductCode(' MED-001 '))).toBe(true);
    expect(annex.has(normalizeTariffProductCode('MED-01'))).toBe(false);
    expect(annex.has(normalizeTariffProductCode('Medicamento'))).toBe(false);
  });
});
