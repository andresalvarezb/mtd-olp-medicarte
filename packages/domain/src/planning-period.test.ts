import { describe, expect, it } from 'vitest';
import {
  PlanningPeriodStructuralError,
  PlanningPeriodTransitionError,
  assertPlanningPeriodTransition,
  assertStructuralEditAllowed,
  bogotaDateOf,
  canTransitionPlanningPeriod,
  classifyScheduleTiming,
  isPlanningPeriodStructurallyEditable,
  validatePlanningPeriodDates,
} from './planning-period';

const VALID_PERIOD = {
  startDate: '2030-01-06',
  endDate: '2030-01-12',
  schedulingCutoffAt: '2030-01-07T23:59:00-05:00',
  purchaseOrderDeadlineAt: '2030-01-08T23:59:00-05:00',
  expectedDeliveryDate: '2030-01-13',
};

describe('validatePlanningPeriodDates', () => {
  it('accepts a coherent period', () => {
    expect(validatePlanningPeriodDates(VALID_PERIOD)).toEqual([]);
  });

  it('rejects an inverted range', () => {
    const issues = validatePlanningPeriodDates({
      ...VALID_PERIOD,
      startDate: '2030-01-13',
      endDate: '2030-01-06',
    });
    expect(issues.map((issue) => issue.code)).toContain('PLANNING_PERIOD_INVALID_RANGE');
  });

  it('rejects a cutoff after the purchase order deadline', () => {
    const issues = validatePlanningPeriodDates({
      ...VALID_PERIOD,
      schedulingCutoffAt: '2030-01-09T00:00:00-05:00',
    });
    expect(issues.map((issue) => issue.code)).toContain('PLANNING_PERIOD_INVALID_DEADLINE_ORDER');
  });

  it('rejects a purchase order deadline after the expected delivery date', () => {
    const issues = validatePlanningPeriodDates({
      ...VALID_PERIOD,
      purchaseOrderDeadlineAt: '2030-01-14T00:00:00-05:00',
      expectedDeliveryDate: '2030-01-13',
    });
    expect(issues.map((issue) => issue.code)).toContain('PLANNING_PERIOD_DELIVERY_BEFORE_DEADLINE');
  });

  it('accepts the same calendar day in Bogota for deadline and delivery', () => {
    const issues = validatePlanningPeriodDates({
      ...VALID_PERIOD,
      purchaseOrderDeadlineAt: '2030-01-13T23:00:00-05:00',
      expectedDeliveryDate: '2030-01-13',
    });
    expect(issues).toEqual([]);
  });

  it('uses the Bogota calendar date for late-night UTC instants', () => {
    expect(bogotaDateOf('2030-01-14T02:00:00Z')).toBe('2030-01-13');
  });
});

describe('planning period state machine', () => {
  it('allows only forward single-step transitions', () => {
    expect(canTransitionPlanningPeriod('OPEN', 'PLANNING_CLOSED')).toBe(true);
    expect(canTransitionPlanningPeriod('PLANNING_CLOSED', 'PURCHASING')).toBe(true);
    expect(canTransitionPlanningPeriod('PURCHASING', 'IN_FULFILLMENT')).toBe(true);
    expect(canTransitionPlanningPeriod('IN_FULFILLMENT', 'OPERATIONAL')).toBe(true);
    expect(canTransitionPlanningPeriod('OPERATIONAL', 'CLOSED')).toBe(true);
    expect(canTransitionPlanningPeriod('OPEN', 'PURCHASING')).toBe(false);
    expect(canTransitionPlanningPeriod('OPEN', 'OPEN')).toBe(false);
    expect(canTransitionPlanningPeriod('PLANNING_CLOSED', 'OPEN')).toBe(false);
    expect(canTransitionPlanningPeriod('CLOSED', 'OPEN')).toBe(false);
  });

  it('throws on an invalid transition', () => {
    expect(() => assertPlanningPeriodTransition('OPEN', 'CLOSED')).toThrow(
      PlanningPeriodTransitionError,
    );
    expect(() => assertPlanningPeriodTransition('CLOSED', 'OPERATIONAL')).toThrow(
      'Transition CLOSED -> OPERATIONAL is not allowed',
    );
  });
});

describe('structural edit rules', () => {
  it('allows structural edits in OPEN and PLANNING_CLOSED only', () => {
    expect(isPlanningPeriodStructurallyEditable('OPEN')).toBe(true);
    expect(isPlanningPeriodStructurallyEditable('PLANNING_CLOSED')).toBe(true);
    expect(isPlanningPeriodStructurallyEditable('PURCHASING')).toBe(false);
    expect(isPlanningPeriodStructurallyEditable('OPERATIONAL')).toBe(false);
    expect(isPlanningPeriodStructurallyEditable('CLOSED')).toBe(false);
  });

  it('throws when structural fields change after planning', () => {
    expect(() => assertStructuralEditAllowed('PURCHASING', ['endDate'])).toThrow(
      PlanningPeriodStructuralError,
    );
    expect(() => assertStructuralEditAllowed('PURCHASING', ['schedulingCutoffAt'])).not.toThrow();
    expect(() => assertStructuralEditAllowed('PLANNING_CLOSED', ['startDate'])).not.toThrow();
  });
});

describe('classifyScheduleTiming', () => {
  const period = { schedulingCutoffAt: '2030-01-07T23:59:00-05:00' };

  it('classifies before and exactly at the cutoff as ON_TIME', () => {
    expect(classifyScheduleTiming(period, '2030-01-06T10:00:00-05:00')).toBe('ON_TIME');
    expect(classifyScheduleTiming(period, '2030-01-07T23:59:00-05:00')).toBe('ON_TIME');
  });

  it('classifies after the cutoff as LATE', () => {
    // El corte es 2030-01-07T23:59:00-05:00 = 2030-01-08T04:59:00Z.
    expect(classifyScheduleTiming(period, '2030-01-08T00:00:00-05:00')).toBe('LATE');
    expect(classifyScheduleTiming(period, '2030-01-08T05:30:00Z')).toBe('LATE');
  });
});
