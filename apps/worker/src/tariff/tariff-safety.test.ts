import { describe, expect, it } from 'vitest';
import { canonicalizeTariffMoney, previewTariffRows } from './tariff-import-parser';

describe('tariff safety', () => {
  it('canonicalizes integer and decimal money without losing raw semantics', () => {
    expect(canonicalizeTariffMoney(7420)).toEqual({ raw: '7420', canonical: '7420.0000' });
    expect(canonicalizeTariffMoney('7,42')).toEqual({ raw: '7,42', canonical: '7.4200' });
  });
  it.each([['7420', '7.42'], ['7.42', '7420']])('detects bidirectional x1000 anomaly', (before, after) => {
    const result = previewTariffRows([{ rowNumber: 2, codigoProducto: 'X', rawData: { TARIFA_UNIDAD: after } }], new Map([['X', before]]));
    expect(result.rows[0]?.state).toBe('ANOMALOUS');
  });
  it('detects a batch scale pattern and counts preview states', () => {
    const rows = [
      { rowNumber: 2, codigoProducto: 'A', rawData: { TARIFA_UNIDAD: '1' } },
      { rowNumber: 3, codigoProducto: 'B', rawData: { TARIFA_UNIDAD: '2' } },
      { rowNumber: 4, codigoProducto: 'C', rawData: { TARIFA_UNIDAD: '9' } },
    ];
    const result = previewTariffRows(rows, new Map([['A', '1000'], ['B', '2000'], ['C', '9']]));
    expect(result).toMatchObject({ total: 3, anomalous: 2, unchanged: 1, scalePatternDetected: true });
  });
});
