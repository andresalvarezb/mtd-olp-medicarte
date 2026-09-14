import { describe, expect, it } from 'vitest';
import {
  PROJECTED_TARIFF_NOTE,
  PURCHASE_COVERAGE_LABEL,
  PURCHASE_COVERAGE_NOTE,
  REQUESTED_QUANTITY_LABEL,
  REQUESTED_QUANTITY_NOTE,
} from './operational-indicators-ui';

describe('ESP-013 indicator labels', () => {
  it('does not label purchase coverage as purchased quantity', () => {
    expect(PURCHASE_COVERAGE_LABEL).toBe('Cobertura/asignación de compra');
    expect(PURCHASE_COVERAGE_LABEL.toLowerCase()).not.toContain('comprado');
    expect(PURCHASE_COVERAGE_NOTE.toLowerCase()).not.toContain('comprado');
  });

  it('keeps requested quantity distinct from coverage', () => {
    expect(REQUESTED_QUANTITY_LABEL).toBe('Solicitado a OLP');
    expect(REQUESTED_QUANTITY_LABEL).not.toBe(PURCHASE_COVERAGE_LABEL);
    expect(REQUESTED_QUANTITY_NOTE).toMatch(/excluye draft/i);
    expect(PURCHASE_COVERAGE_NOTE).toMatch(/incluye.*draft/i);
  });

  it('states that the current annex is not a historical tariff', () => {
    expect(PROJECTED_TARIFF_NOTE.toLowerCase()).toContain('tarifa histórica');
    expect(PROJECTED_TARIFF_NOTE.toLowerCase()).toContain('no sustituye');
  });
});
