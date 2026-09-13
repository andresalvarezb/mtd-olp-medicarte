import { describe, expect, it } from 'vitest';
import {
  DemandConsolidationError,
  resolveEffectiveSchedulePeriod,
  sumDemandQuantities,
} from './demand-consolidation';

describe('resolveEffectiveSchedulePeriod', () => {
  it('ON_TIME keeps its own planning period as regular', () => {
    expect(
      resolveEffectiveSchedulePeriod({
        scheduleTiming: 'ON_TIME',
        lateHandling: null,
        planningPeriodId: 'period-1',
        deferredPlanningPeriodId: null,
      }),
    ).toEqual({ effectivePeriodId: 'period-1', classification: 'REGULAR' });
  });

  it('LATE + COMPLEMENTARY_PURCHASE_ORDER stays in its own period as late', () => {
    expect(
      resolveEffectiveSchedulePeriod({
        scheduleTiming: 'LATE',
        lateHandling: 'COMPLEMENTARY_PURCHASE_ORDER',
        planningPeriodId: 'period-1',
        deferredPlanningPeriodId: null,
      }),
    ).toEqual({ effectivePeriodId: 'period-1', classification: 'LATE' });
  });

  it('LATE + NEXT_PERIOD reaches the deferred period as REGULAR while keeping historic facts', () => {
    expect(
      resolveEffectiveSchedulePeriod({
        scheduleTiming: 'LATE',
        lateHandling: 'NEXT_PERIOD',
        planningPeriodId: 'period-1',
        deferredPlanningPeriodId: 'period-next',
      }),
    ).toEqual({ effectivePeriodId: 'period-next', classification: 'REGULAR' });
  });

  it('LATE + NEXT_PERIOD without deferred period fails explicitly', () => {
    expect(() =>
      resolveEffectiveSchedulePeriod({
        scheduleTiming: 'LATE',
        lateHandling: 'NEXT_PERIOD',
        planningPeriodId: 'period-1',
        deferredPlanningPeriodId: null,
      }),
    ).toThrow(DemandConsolidationError);
  });
});

describe('sumDemandQuantities', () => {
  it('splits regular/late by bucket and preserves projected = regular + late', () => {
    expect(
      sumDemandQuantities([
        { quantity: 3, classification: 'REGULAR' },
        { quantity: 2, classification: 'REGULAR' },
        { quantity: 5, classification: 'LATE' },
        { quantity: 1, classification: 'LATE' },
      ]),
    ).toEqual({ regularQuantity: 5, lateQuantity: 6, projectedQuantity: 11 });
    // Los hechos históricos (scheduleTiming) son documentales, no suman.
    expect(
      sumDemandQuantities([
        { quantity: 3, classification: 'REGULAR', originScheduleTiming: 'LATE' },
      ]).regularQuantity,
    ).toBe(3);
    expect(sumDemandQuantities([])).toEqual({
      regularQuantity: 0,
      lateQuantity: 0,
      projectedQuantity: 0,
    });
  });
});
