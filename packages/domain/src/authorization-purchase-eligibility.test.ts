import { describe, expect, it } from 'vitest';
import {
  authorizationPurchaseMonthEnd,
  evaluateAuthorizationPurchaseEligibility,
  isAuthorizationSourceEnabled,
} from './authorization-purchase-eligibility';

describe('authorization purchase eligibility', () => {
  const today = '2026-09-19';

  it('recognizes only source status 5 as enabled', () => {
    expect(isAuthorizationSourceEnabled('5')).toBe(true);
    expect(isAuthorizationSourceEnabled(5)).toBe(true);
    expect(isAuthorizationSourceEnabled(' 5 ')).toBe(true);

    expect(isAuthorizationSourceEnabled('VIGENTE')).toBe(false);
    expect(isAuthorizationSourceEnabled('ACTIVA')).toBe(false);
    expect(isAuthorizationSourceEnabled('AUTORIZADA')).toBe(false);
    expect(isAuthorizationSourceEnabled('4')).toBe(false);
    expect(isAuthorizationSourceEnabled('')).toBe(false);
  });

  it('calculates the operational month end deterministically', () => {
    expect(authorizationPurchaseMonthEnd('2026-09-19')).toBe('2026-09-30');
    expect(authorizationPurchaseMonthEnd('2026-02-10')).toBe('2026-02-28');
    expect(authorizationPurchaseMonthEnd('2028-02-10')).toBe('2028-02-29');
  });

  it.each([
    {
      label: 'September to September',
      assignmentDate: '2026-09-01',
      expirationDate: '2026-09-30',
    },
    {
      label: 'September to October',
      assignmentDate: '2026-09-01',
      expirationDate: '2026-10-31',
    },
    {
      label: 'August to October and still current',
      assignmentDate: '2026-08-15',
      expirationDate: '2026-10-15',
    },
    {
      label: 'starts later inside September',
      assignmentDate: '2026-09-25',
      expirationDate: '2026-10-25',
    },
  ])('allows $label during September 2026', ({ assignmentDate, expirationDate }) => {
    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate,
        expirationDate,
        todayBogota: today,
      }),
    ).toMatchObject({
      eligible: true,
      reason: 'ELIGIBLE',
      currentMonthEnd: '2026-09-30',
    });
  });

  it.each([
    {
      label: 'October to October inside rolling horizon',
      assignmentDate: '2026-10-01',
      expirationDate: '2026-10-31',
    },
    {
      label: 'October to November inside rolling horizon',
      assignmentDate: '2026-10-01',
      expirationDate: '2026-11-30',
    },
    {
      label: 'starts exactly on today plus 30',
      assignmentDate: '2026-10-19',
      expirationDate: '2026-11-30',
    },
  ])(
    'allows $label while inside today plus 30',
    ({ assignmentDate, expirationDate }) => {
      expect(
        evaluateAuthorizationPurchaseEligibility({
          sourceStatus: '5',
          assignmentDate,
          expirationDate,
          todayBogota: today,
        }),
      ).toMatchObject({
        eligible: true,
        reason: 'ELIGIBLE',
      });
    },
  );

  it.each([
    {
      label: 'day after today plus 30',
      assignmentDate: '2026-10-20',
      expirationDate: '2026-11-30',
    },
    {
      label: 'November to December',
      assignmentDate: '2026-11-01',
      expirationDate: '2026-12-31',
    },
  ])(
    'blocks $label outside today plus 30',
    ({ assignmentDate, expirationDate }) => {
      expect(
        evaluateAuthorizationPurchaseEligibility({
          sourceStatus: '5',
          assignmentDate,
          expirationDate,
          todayBogota: today,
        }),
      ).toMatchObject({
        eligible: false,
        reason: 'FUTURE_VIGENCY',
      });
    },
  );

  it('blocks expired authorization', () => {
    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2026-08-01',
        expirationDate: '2026-09-18',
        todayBogota: today,
      }),
    ).toMatchObject({
      eligible: false,
      reason: 'EXPIRED',
    });
  });

  it('blocks source status different from 5', () => {
    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '4',
        assignmentDate: '2026-09-01',
        expirationDate: '2026-10-31',
        todayBogota: today,
      }),
    ).toMatchObject({
      eligible: false,
      reason: 'SOURCE_STATUS_BLOCKED',
    });
  });

  it('rejects invalid assignment and expiration dates', () => {
    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2026-02-31',
        expirationDate: '2026-10-31',
        todayBogota: today,
      }),
    ).toMatchObject({
      eligible: false,
      reason: 'ASSIGNMENT_DATE_INVALID',
    });

    expect(
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2026-09-01',
        expirationDate: '2026-13-01',
        todayBogota: today,
      }),
    ).toMatchObject({
      eligible: false,
      reason: 'EXPIRATION_DATE_INVALID',
    });
  });

  it('automatically becomes eligible when it enters the rolling horizon', () => {
    const outsideHorizon =
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2026-10-20',
        expirationDate: '2026-11-30',
        todayBogota: '2026-09-19',
      });

    expect(outsideHorizon).toMatchObject({
      eligible: false,
      reason: 'FUTURE_VIGENCY',
    });

    const insideHorizon =
      evaluateAuthorizationPurchaseEligibility({
        sourceStatus: '5',
        assignmentDate: '2026-10-20',
        expirationDate: '2026-11-30',
        todayBogota: '2026-09-20',
      });

    expect(insideHorizon).toMatchObject({
      eligible: true,
      reason: 'ELIGIBLE',
    });
  });
});
