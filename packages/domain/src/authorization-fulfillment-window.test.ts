import { describe, expect, it } from 'vitest';

import { currentBogotaDate } from './mipres';
import { evaluateAuthorizationFulfillmentWindow } from './authorization-fulfillment-window';

const base = {
  expirationDate: '2026-11-10',
  todayBogota: '2026-11-10',
  hasConfirmedAttention: false,
  remainingAuthorizedQuantity: 10,
};

describe('authorization fulfillment calendar window', () => {
  it('treats the expiration date as inclusive in the Bogota calendar', () => {
    expect(evaluateAuthorizationFulfillmentWindow(base)).toMatchObject({
      eligible: true,
      eligibleForNewReservation: true,
      status: 'CURRENT',
      daysAfterExpiration: 0,
    });
  });

  it.each([
    ['first grace day', '2026-11-11', 1],
    ['fifth grace day', '2026-11-15', 5],
  ])('allows %s for a first attention', (_name, todayBogota, daysAfterExpiration) => {
    expect(evaluateAuthorizationFulfillmentWindow({ ...base, todayBogota })).toMatchObject({
      eligible: true,
      eligibleForNewReservation: true,
      status: 'GRACE',
      daysAfterExpiration,
    });
  });

  it('blocks first attention and new reservations from day six', () => {
    expect(
      evaluateAuthorizationFulfillmentWindow({
        ...base,
        todayBogota: '2026-11-16',
      }),
    ).toMatchObject({
      eligible: false,
      eligibleForNewReservation: false,
      status: 'BLOCKED_AFTER_GRACE',
      daysAfterExpiration: 6,
    });
  });

  it('allows a physical reservation top-up for an attended AUTO after grace', () => {
    expect(
      evaluateAuthorizationFulfillmentWindow({
        ...base,
        todayBogota: '2026-12-10',
        hasConfirmedAttention: true,
      }),
    ).toMatchObject({
      eligible: true,
      eligibleForNewReservation: true,
      status: 'PARTIAL_CONTINUATION',
      daysAfterExpiration: 30,
    });
  });

  it('keeps new reservation eligibility blocked after grace without confirmed attention', () => {
    expect(
      evaluateAuthorizationFulfillmentWindow({
        ...base,
        todayBogota: '2026-12-10',
        hasConfirmedAttention: false,
      }),
    ).toMatchObject({
      eligible: false,
      eligibleForNewReservation: false,
      status: 'BLOCKED_AFTER_GRACE',
    });
  });

  it('does not allow continuation after the authorized quantity is exhausted', () => {
    expect(
      evaluateAuthorizationFulfillmentWindow({
        ...base,
        todayBogota: '2026-12-10',
        hasConfirmedAttention: true,
        remainingAuthorizedQuantity: 0,
      }),
    ).toMatchObject({ eligible: false, status: 'COMPLETE' });
  });

  it('counts calendar days across month and year boundaries', () => {
    expect(
      evaluateAuthorizationFulfillmentWindow({
        ...base,
        expirationDate: '2026-12-31',
        todayBogota: '2027-01-05',
      }),
    ).toMatchObject({ status: 'GRACE', daysAfterExpiration: 5 });
  });

  it('changes from day five to day six at Bogota midnight, independent of UTC date', () => {
    const beforeMidnightBogota = currentBogotaDate(new Date('2026-11-16T04:59:59.999Z'));
    const atMidnightBogota = currentBogotaDate(new Date('2026-11-16T05:00:00.000Z'));

    expect(beforeMidnightBogota).toBe('2026-11-15');
    expect(atMidnightBogota).toBe('2026-11-16');
    expect(
      evaluateAuthorizationFulfillmentWindow({ ...base, todayBogota: beforeMidnightBogota }),
    ).toMatchObject({ status: 'GRACE', daysAfterExpiration: 5 });
    expect(
      evaluateAuthorizationFulfillmentWindow({ ...base, todayBogota: atMidnightBogota }),
    ).toMatchObject({ status: 'BLOCKED_AFTER_GRACE', daysAfterExpiration: 6 });
  });

  it('rejects invalid dates instead of making them eligible', () => {
    expect(
      evaluateAuthorizationFulfillmentWindow({
        ...base,
        expirationDate: '2026-02-30',
      }),
    ).toMatchObject({
      eligible: false,
      eligibleForNewReservation: false,
      status: 'INVALID_DATE',
    });
  });
});
