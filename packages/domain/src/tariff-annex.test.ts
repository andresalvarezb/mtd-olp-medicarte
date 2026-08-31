import { describe, expect, it } from 'vitest';
import {
  MAX_TARIFF_PRODUCT_CODE_LENGTH,
  TARIFF_ANNEX_RULE_VERSION,
  deriveEpsNovedadCausales,
  deriveTariffMembershipStatus,
  epsNovedadCausalMessages,
  isValidTariffProductCode,
  normalizeTariffProductCode,
} from './tariff-annex';

describe('tariff annex', () => {
  it('normalizes product codes with the same technical rule as COD_COMERCIAL', () => {
    expect(normalizeTariffProductCode('  abc 001 ')).toBe('ABC 001');
    expect(normalizeTariffProductCode(12345)).toBe('12345');
    expect(normalizeTariffProductCode(null)).toBe('');
  });

  it('validates product code format and length', () => {
    expect(isValidTariffProductCode('ABC001')).toBe(true);
    expect(isValidTariffProductCode('')).toBe(false);
    expect(isValidTariffProductCode('   '.trim())).toBe(false);
    expect(isValidTariffProductCode('X'.repeat(MAX_TARIFF_PRODUCT_CODE_LENGTH))).toBe(true);
    expect(isValidTariffProductCode('X'.repeat(MAX_TARIFF_PRODUCT_CODE_LENGTH + 1))).toBe(false);
  });

  it('derives the membership status exposed in authorization_items', () => {
    expect(deriveTariffMembershipStatus(true)).toBe('LISTADO');
    expect(deriveTariffMembershipStatus(false)).toBe('NO_LISTADO');
  });

  it('exposes the stable PRODUCT_NOT_IN_TARIFF_ANNEX message', () => {
    expect(epsNovedadCausalMessages.PRODUCT_NOT_IN_TARIFF_ANNEX).toBe(
      'Producto no incluido en el Anexo Tarifario',
    );
    expect(TARIFF_ANNEX_RULE_VERSION).toBe('TARIFF-ANNEX-1');
  });

  it('derives a single annex causal for a record blocked only by the annex', () => {
    expect(
      deriveEpsNovedadCausales({
        enablementStatus: 'HABILITADO',
        operationStatus: 'BLOQUEADO',
        coverageType: 'PBS',
        directionStatus: 'NO_APLICA',
        tariffMembershipStatus: 'NO_LISTADO',
        today: '2026-08-31',
      }),
    ).toEqual(['PRODUCT_NOT_IN_TARIFF_ANNEX']);
  });

  it('keeps every active causal when several validations fail', () => {
    expect(
      deriveEpsNovedadCausales({
        enablementStatus: 'HABILITADO',
        operationStatus: 'BLOQUEADO',
        coverageType: 'NO_PBS',
        directionStatus: 'PENDIENTE',
        tariffMembershipStatus: 'NO_LISTADO',
        fechaFinalVigencia: '20260101',
        today: '2026-08-31',
      }),
    ).toEqual([
      'AUTHORIZATION_EXPIRED',
      'DIRECTION_PENDING',
      'PRODUCT_NOT_IN_TARIFF_ANNEX',
    ]);
  });

  it('reports source status blocking and MIPRES query errors', () => {
    expect(
      deriveEpsNovedadCausales({
        enablementStatus: 'BLOQUEADO_POR_ESTADO_ORIGEN',
        operationStatus: 'BLOQUEADO',
        coverageType: 'NO_PBS',
        directionStatus: 'ERROR_DE_CONSULTA',
        tariffMembershipStatus: 'LISTADO',
      }),
    ).toEqual(['SOURCE_STATUS_BLOCKED', 'DIRECTION_QUERY_ERROR']);
  });

  it('returns no causales for records that already progressed after readiness', () => {
    for (const operationStatus of [
      'LISTO_PARA_DISPENSAR',
      'DISPENSACION_REPORTADA',
      'DISPENSADO',
    ] as const) {
      expect(
        deriveEpsNovedadCausales({
          enablementStatus: 'HABILITADO',
          operationStatus,
          coverageType: 'PBS',
          directionStatus: 'NO_APLICA',
          tariffMembershipStatus: 'LISTADO',
        }),
      ).toEqual([]);
    }
  });
});
