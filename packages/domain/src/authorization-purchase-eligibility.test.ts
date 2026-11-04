import { describe, expect, it } from 'vitest';
import {
  authorizationPurchaseMonthEnd,
  evaluateAuthorizationPurchaseEligibility,
  isAuthorizationSourceEnabled,
} from './authorization-purchase-eligibility';

describe('authorization purchase eligibility', () => {
  it('recognizes only source status 5 as enabled', () => {
    expect(isAuthorizationSourceEnabled('5')).toBe(true);
    expect(isAuthorizationSourceEnabled(5)).toBe(true);
    expect(isAuthorizationSourceEnabled(' 5 ')).toBe(true);
    expect(isAuthorizationSourceEnabled('ANULADA')).toBe(false);
    expect(isAuthorizationSourceEnabled('4')).toBe(false);
  });

  it('calculates the management month end deterministically', () => {
    expect(authorizationPurchaseMonthEnd('2026-09-19')).toBe('2026-09-30');
    expect(authorizationPurchaseMonthEnd('2028-02-10')).toBe('2028-02-29');
  });

  it('delegates temporal eligibility to the assignment validity rule', () => {
    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2026-12-31',
        expirationDate: '2027-01-01',
        todayBogota: '2026-12-01',
      }),
    ).toMatchObject({ eligible: true, reason: 'ELIGIBLE' });

    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2027-01-10',
        expirationDate: '2027-01-31',
        todayBogota: '2026-12-20',
      }),
    ).toMatchObject({ eligible: false, reason: 'ASSIGNMENT_OUTSIDE_WINDOW' });

    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2026-12-01',
        expirationDate: '2026-12-19',
        todayBogota: '2026-12-20',
      }),
    ).toMatchObject({ eligible: false, reason: 'EXPIRED' });
  });

  it('keeps source status as a separate purchase gate', () => {
    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '4',
        assignmentDate: '2026-12-20',
        expirationDate: '2026-12-20',
        todayBogota: '2026-12-20',
      }),
    ).toMatchObject({ eligible: false, reason: 'SOURCE_STATUS_BLOCKED' });
  });
});
