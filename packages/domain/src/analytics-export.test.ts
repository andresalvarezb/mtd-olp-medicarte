import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EXPORT_UNAVAILABLE_LABEL,
  exportMoneyCell,
  moneyExportRow,
} from './analytics-export';
import { appliedSupplierCostMetric, exactMoney, unavailableMoney } from './operational-analytics';

describe('ESP-014 analytics export mapping', () => {
  it('keeps UNAVAILABLE as an explicit label instead of zero', () => {
    const unavailable = unavailableMoney('HISTORICAL_TARIFF_UNAVAILABLE');
    expect(exportMoneyCell(unavailable)).toBe(ANALYTICS_EXPORT_UNAVAILABLE_LABEL);
    expect(exportMoneyCell(unavailable)).not.toBe('0');
    expect(exportMoneyCell(unavailable)).not.toBe('0.00');
    expect(moneyExportRow('projectedTariffReferenceValue', unavailable)[2]).toBe(
      ANALYTICS_EXPORT_UNAVAILABLE_LABEL,
    );
  });

  it('preserves exact money strings and does not fabricate applied cost', () => {
    expect(exportMoneyCell(exactMoney('150.00', 'PURCHASE_ORDER_SNAPSHOT'))).toBe('150.00');
    expect(exportMoneyCell(appliedSupplierCostMetric())).toBe(ANALYTICS_EXPORT_UNAVAILABLE_LABEL);
    expect(appliedSupplierCostMetric().reason).toBe('AMBIGUOUS_LOT_PROVENANCE');
  });
});
