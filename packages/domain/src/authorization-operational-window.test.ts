import { describe, expect, it } from 'vitest';

import {
  authorizationOperationalHorizonEnd,
  evaluateAuthorizationOperationalWindow,
  normalizeAuthorizationOperationalDate,
} from './authorization-operational-window';

describe('authorization operational window', () => {
  it('calculates today plus 30 calendar days', () => {
    expect(authorizationOperationalHorizonEnd('2026-09-25')).toBe('2026-10-25');
  });

  it('accepts the horizon boundary inclusively', () => {
    expect(
      evaluateAuthorizationOperationalWindow({
        assignmentDate: '2026-10-25',
        expirationDate: '2026-11-30',
        todayBogota: '2026-09-25',
      }),
    ).toMatchObject({
      eligible: true,
      status: 'IN_WINDOW',
    });
  });

  it('blocks the day after the horizon', () => {
    expect(
      evaluateAuthorizationOperationalWindow({
        assignmentDate: '2026-10-26',
        expirationDate: '2026-11-30',
        todayBogota: '2026-09-25',
      }),
    ).toMatchObject({
      eligible: false,
      status: 'OUTSIDE_HORIZON',
    });
  });

  it('expires only before today', () => {
    expect(
      evaluateAuthorizationOperationalWindow({
        assignmentDate: '2026-09-01',
        expirationDate: '2026-09-25',
        todayBogota: '2026-09-25',
      }),
    ).toMatchObject({
      eligible: true,
      status: 'IN_WINDOW',
    });

    expect(
      evaluateAuthorizationOperationalWindow({
        assignmentDate: '2026-09-01',
        expirationDate: '2026-09-24',
        todayBogota: '2026-09-25',
      }),
    ).toMatchObject({
      eligible: false,
      status: 'EXPIRED',
    });
  });

  it('normalizes compact source dates', () => {
    expect(normalizeAuthorizationOperationalDate('20261025')).toBe('2026-10-25');

    expect(
      evaluateAuthorizationOperationalWindow({
        assignmentDate: '20261025',
        expirationDate: '20261130',
        todayBogota: '2026-09-25',
      }),
    ).toMatchObject({
      eligible: true,
      status: 'IN_WINDOW',
    });
  });

  it('rejects invalid calendar dates', () => {
    expect(
      evaluateAuthorizationOperationalWindow({
        assignmentDate: '2026-02-31',
        expirationDate: '2026-11-30',
        todayBogota: '2026-09-25',
      }),
    ).toMatchObject({
      eligible: false,
      status: 'INVALID_DATE',
    });
  });
});
