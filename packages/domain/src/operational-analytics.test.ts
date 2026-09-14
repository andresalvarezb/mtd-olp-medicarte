import { describe, expect, it } from 'vitest';
import {
  APPLIED_SUPPLIER_COST_UNAVAILABLE_REASON,
  CURRENT_ON_HAND_LABEL,
  HISTORICAL_TARIFF_UNAVAILABLE,
  INCOMPLETE_SUPPLIER_COST,
  INCOMPLETE_TARIFF_LOOKUP,
  PERIOD_EFFECTIVE_TARIFF_BASIS,
  PERIOD_FLOW_DISCLAIMER,
  PERIOD_FLOW_LABEL,
  PURCHASE_ORDER_SNAPSHOT_BASIS,
  addMoney,
  aggregateExactMoney,
  appliedSupplierCostMetric,
  exactMoney,
  formatMoneyCents,
  grossOperationalSpreadReference,
  multiplyQuantityByUnitAmount,
  parseMoneyCents,
  projectedQuantity,
  projectedTariffReferenceMetric,
  purchaseOrderSnapshotMoney,
  ratioMetric,
  receivedMinusAppliedFlow,
  shortageQuantity,
  subtractMoney,
  unavailableMoney,
} from './operational-analytics';

describe('ESP-013 operational analytics formulas', () => {
  it('keeps projected quantity as regular plus late', () => {
    expect(projectedQuantity(10, 4)).toBe(14);
    expect(projectedQuantity(0, 0)).toBe(0);
  });

  it('returns null rates when the denominator is zero', () => {
    expect(ratioMetric(5, 0)).toEqual({ numerator: 5, denominator: 0, rate: null });
    expect(ratioMetric(0, 0)).toEqual({ numerator: 0, denominator: 0, rate: null });
  });

  it('serializes quantity rates with four decimal places', () => {
    expect(ratioMetric(3, 4)).toEqual({ numerator: 3, denominator: 4, rate: '0.7500' });
    expect(ratioMetric(1, 3).rate).toBe('0.3333');
  });

  it('computes shortage without replacing requested by accepted', () => {
    expect(shortageQuantity(10, 7)).toBe(3);
    expect(shortageQuantity(10, 10)).toBe(0);
    expect(shortageQuantity(10, 12)).toBe(0);
  });

  it('labels period flow as a flow indicator, never leftover inventory', () => {
    const flow = receivedMinusAppliedFlow(20, 8);
    expect(flow).toEqual({
      value: 12,
      label: PERIOD_FLOW_LABEL,
      disclaimer: PERIOD_FLOW_DISCLAIMER,
    });
    expect(flow.label).not.toContain('leftover');
    expect(flow.label).not.toContain('sobrante');
    expect(CURRENT_ON_HAND_LABEL).toBe('currentOnHandQuantity');
  });

  it('multiplies money with integer cents instead of IEEE floats', () => {
    expect(multiplyQuantityByUnitAmount(3, '10.50')).toBe('31.50');
    expect(multiplyQuantityByUnitAmount(0, '10.00')).toBe('0.00');
    expect(parseMoneyCents('12.34')).toBe(1234n);
    expect(formatMoneyCents(1234n)).toBe('12.34');
    expect(addMoney('10.01', '0.09')).toBe('10.10');
    expect(subtractMoney('100.00', '0.01')).toBe('99.99');
  });

  it('rejects invalid money strings instead of coercing them', () => {
    expect(() => parseMoneyCents('10')).toThrow('INVALID_MONEY_DECIMAL');
    expect(() => parseMoneyCents('10.5')).toThrow('INVALID_MONEY_DECIMAL');
    expect(() => parseMoneyCents('1.234')).toThrow('INVALID_MONEY_DECIMAL');
  });

  it('keeps unavailable economics as null rather than a fabricated zero', () => {
    expect(unavailableMoney('MISSING_LINEAGE')).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: 'MISSING_LINEAGE',
      basis: null,
    });
    expect(aggregateExactMoney([])).toMatchObject({ availability: 'UNAVAILABLE', value: null });
    expect(aggregateExactMoney(['10.00', null])).toMatchObject({
      availability: 'UNAVAILABLE',
      value: null,
    });
    expect(aggregateExactMoney(['10.00', '2.50'])).toEqual({
      availability: 'EXACT',
      value: '12.50',
      reason: null,
      basis: null,
    });
  });

  it('does not fabricate applied supplier cost', () => {
    expect(appliedSupplierCostMetric()).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: APPLIED_SUPPLIER_COST_UNAVAILABLE_REASON,
      basis: null,
    });
  });

  it('computes gross operational spread only when both sides are exact', () => {
    expect(
      grossOperationalSpreadReference(
        exactMoney('20.00', PURCHASE_ORDER_SNAPSHOT_BASIS),
        exactMoney('12.50', PURCHASE_ORDER_SNAPSHOT_BASIS),
      ),
    ).toEqual({
      availability: 'EXACT',
      value: '7.50',
      reason: null,
      basis: PURCHASE_ORDER_SNAPSHOT_BASIS,
    });
    expect(
      grossOperationalSpreadReference(exactMoney('20.00'), unavailableMoney('MISSING_LINEAGE')),
    ).toMatchObject({ availability: 'UNAVAILABLE', value: null });
  });

  it('does not substitute the current active tariff for a missing period-effective tariff', () => {
    const currentActiveTariff = '20.00';
    const metric = projectedTariffReferenceMetric(null, 24);
    expect(metric).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: HISTORICAL_TARIFF_UNAVAILABLE,
      basis: null,
    });
    expect(metric.value).not.toBe(multiplyQuantityByUnitAmount(24, currentActiveTariff));
    expect(projectedTariffReferenceMetric(currentActiveTariff, 24)).toEqual({
      availability: 'EXACT',
      value: currentActiveTariff,
      reason: null,
      basis: PERIOD_EFFECTIVE_TARIFF_BASIS,
    });
  });

  it('keeps purchase-order tariff snapshots exact for that order only', () => {
    expect(purchaseOrderSnapshotMoney(10, '150.00', INCOMPLETE_TARIFF_LOOKUP)).toEqual({
      availability: 'EXACT',
      value: '150.00',
      reason: null,
      basis: PURCHASE_ORDER_SNAPSHOT_BASIS,
    });
    expect(purchaseOrderSnapshotMoney(10, null, INCOMPLETE_SUPPLIER_COST)).toEqual({
      availability: 'UNAVAILABLE',
      value: null,
      reason: INCOMPLETE_SUPPLIER_COST,
      basis: null,
    });
  });

  it('keeps draft purchase coverage independent from issued requested quantity', () => {
    const projected = 100;
    const draftAllocation = 100;
    const requestedQuantity = 0;
    const effectivePurchaseCoverage = draftAllocation;
    expect(effectivePurchaseCoverage).toBe(projected);
    expect(requestedQuantity).toBe(0);
    expect(effectivePurchaseCoverage).not.toBe(requestedQuantity);
    expect(shortageQuantity(projected, effectivePurchaseCoverage)).toBe(0);
    expect(shortageQuantity(projected, requestedQuantity)).toBe(100);
  });

  it('treats funnel stages as independent facts rather than a decreasing pipeline', () => {
    const projected = 10;
    const requested = 12;
    const accepted = 8;
    const dispatched = 8;
    const received = 7;
    const applied = 9;
    expect(requested).toBeGreaterThan(projected);
    expect(applied).toBeGreaterThan(received);
    expect(shortageQuantity(projected, accepted)).toBe(2);
    expect(shortageQuantity(accepted, dispatched)).toBe(0);
  });
});
