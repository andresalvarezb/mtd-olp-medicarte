import { describe, expect, it } from 'vitest';
import {
  EPS_CAUSAL_TO_NOVELTY,
  NOVELTY_ERROR_TYPES,
  noveltyErrorTypeFor,
  noveltyForBulkResult,
  noveltyForImportResult,
  noveltyForTariffImportResult,
} from './novelties';

describe('novelties error catalog (ADR-027)', () => {
  it('classifies unknown error types as requiring human validation', () => {
    expect(NOVELTY_ERROR_TYPES).toHaveLength(3);
    expect(noveltyErrorTypeFor('NOEXISTE')).toBe('REQUIERE_VALIDACION');
    expect(noveltyErrorTypeFor(null)).toBe('REQUIERE_VALIDACION');
    expect(noveltyErrorTypeFor('CORREGIBLE_POR_CARGUE')).toBe('CORREGIBLE_POR_CARGUE');
  });

  it('projects import failures with stable novelty codes', () => {
    expect(noveltyForImportResult('MISSING_REQUIRED_FIELD')).toMatchObject({ code: 'CSV_004' });
    expect(noveltyForImportResult('MISSING_REQUIRED_FIELD', ['NUMERO_AUTORIZACION'])).toMatchObject({
      code: 'CSV_003',
      field: 'NUMERO_AUTORIZACION',
    });
    expect(noveltyForImportResult('INVALID_FIELD_FORMAT', [], 'No.PRESCRIPCION')).toMatchObject({
      code: 'CLS_001',
    });
    expect(noveltyForImportResult('DUPLICATE_IN_FILE')).toMatchObject({ code: 'CSV_002' });
    expect(noveltyForImportResult('PRODUCT_NOT_IN_TARIFF_ANNEX')).toMatchObject({ code: 'ANX_001' });
    expect(noveltyForImportResult('PROCESSING_ERROR')).toMatchObject({ code: 'TECH_001' });
  });

  it('does not turn valid or human-review rows into errors', () => {
    expect(noveltyForImportResult('ROW_VALID')).toBeNull();
    expect(noveltyForImportResult('ITEM_CREATED')).toBeNull();
    expect(noveltyForImportResult('ITEM_UPDATED')).toBeNull();
    expect(noveltyForImportResult('EXISTING_ITEM_REVIEW_REQUIRED')).toBeNull();
    expect(noveltyForTariffImportResult('PRODUCT_CREATED')).toBeNull();
    expect(noveltyForTariffImportResult('PRODUCT_EXISTING')).toBeNull();
    expect(noveltyForBulkResult('ROW_UPDATED')).toBeNull();
    expect(noveltyForBulkResult('UNCHANGED_VALUE')).toBeNull();
  });

  it('maps tariff, bulk and EPS causal projections', () => {
    expect(noveltyForTariffImportResult('INVALID_PRODUCT_CODE')).toMatchObject({ code: 'CSV_005' });
    expect(noveltyForTariffImportResult('DUPLICATE_IN_FILE')).toMatchObject({ code: 'CSV_002' });
    expect(noveltyForTariffImportResult('PROCESSING_ERROR')).toMatchObject({ code: 'TECH_001' });
    expect(noveltyForBulkResult('VERSION_CONFLICT')).toMatchObject({ code: 'CONC_001' });
    expect(noveltyForBulkResult('OPERATION_NOT_ALLOWED')).toMatchObject({ code: 'LOCK_001' });
    expect(noveltyForBulkResult('MISSING_VALUE')).toMatchObject({ code: 'CSV_004' });
    expect(noveltyForBulkResult('PROCESSING_ERROR')).toMatchObject({ code: 'TECH_001' });
    expect(EPS_CAUSAL_TO_NOVELTY.PRODUCT_NOT_IN_TARIFF_ANNEX).toBe('ANX_001');
    expect(EPS_CAUSAL_TO_NOVELTY.AUTHORIZATION_EXPIRED).toBe('AUTH_002');
  });
});
