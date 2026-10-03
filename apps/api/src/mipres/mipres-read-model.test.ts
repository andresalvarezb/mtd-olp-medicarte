import { describe, expect, it } from 'vitest';

import {
  normalizeSourceDate,
  parsePositiveInteger,
  resolveMipresReadState,
  resolveMipresManualUnlockEligibility,
  resolveOperationalWindow,
} from './mipres-read-model';

describe('MIPRES read model', () => {
  it('normalizes supported dates', () => {
    expect(normalizeSourceDate('20310310')).toBe('2031-03-10');

    expect(normalizeSourceDate('2031-03-10T12:00:00Z')).toBe('2031-03-10');

    expect(normalizeSourceDate('20310231')).toBeNull();
  });

  it('parses positive integer quantities only', () => {
    expect(parsePositiveInteger('4')).toBe(4);

    expect(parsePositiveInteger('0')).toBeNull();

    expect(parsePositiveInteger('2.5')).toBeNull();
  });

  it('resolves operational window', () => {
    expect(
      resolveOperationalWindow({
        assignmentDate: '2031-03-01',

        validityEndDate: '2031-03-30',

        today: '2031-03-10',

        horizon: '2031-04-09',
      }),
    ).toBe('IN_WINDOW');
  });

  it('confirmed external evidence does not bypass pending MTD decision', () => {
    expect(
      resolveMipresReadState({
        enablementStatus: 'ENABLED',

        tariffMembershipStatus: 'LISTED',

        coverageType: 'NO_PBS',

        directionStatus: 'CONFIRMED',

        manualDecision: 'PENDING_MANUAL_ENABLEMENT',

        quantity: 4,

        minimumQuantity: 1,

        operationalWindow: 'IN_WINDOW',
      }),
    ).toEqual({
      state: 'BLOCKED',

      authorizationState: 'ENABLED',

      mipresState: 'LOCKED',

      blockedReasons: ['PENDING_MANUAL_ENABLEMENT'],
    });
  });

  it('manual enable is operable only when other gates pass', () => {
    expect(
      resolveMipresReadState({
        enablementStatus: 'ENABLED',

        tariffMembershipStatus: 'LISTED',

        coverageType: 'NO_PBS',

        directionStatus: 'CONFIRMED',

        manualDecision: 'MANUALLY_ENABLED',

        quantity: 4,

        minimumQuantity: 1,

        operationalWindow: 'IN_WINDOW',
      }),
    ).toEqual({
      state: 'OPERABLE',

      authorizationState: 'ENABLED',

      mipresState: 'UNLOCKED',

      blockedReasons: [],
    });
  });

  it('manual enable does not bypass other operational gates', () => {
    const result = resolveMipresReadState({
      enablementStatus: 'ENABLED',

      tariffMembershipStatus: 'NOT_LISTED',

      coverageType: 'NO_PBS',

      directionStatus: 'CONFIRMED',

      manualDecision: 'MANUALLY_ENABLED',

      quantity: 1,

      minimumQuantity: 2,

      operationalWindow: 'EXPIRED',
    });

    expect(result.state).toBe('BLOCKED');

    expect(result.blockedReasons).toEqual([
      'TARIFF_NOT_LISTED',
      'BELOW_MINIMUM_QUANTITY',
      'OPERATIONAL_WINDOW_BLOCKED',
    ]);
  });

  it('manual disable remains blocked', () => {
    expect(
      resolveMipresReadState({
        enablementStatus: 'ENABLED',

        tariffMembershipStatus: 'LISTED',

        coverageType: 'NO_PBS',

        directionStatus: 'CONFIRMED',

        manualDecision: 'MANUALLY_DISABLED',

        quantity: 4,

        minimumQuantity: 1,

        operationalWindow: 'IN_WINDOW',
      }).state,
    ).toBe('BLOCKED');
  });

  it('keeps Habilitacion pending when NO_PBS direction is not confirmed', () => {
    const result = resolveMipresReadState({
      enablementStatus: 'ENABLED',

      tariffMembershipStatus: 'LISTED',

      coverageType: 'NO_PBS',

      directionStatus: 'PENDING',

      manualDecision: 'MANUALLY_ENABLED',

      quantity: 4,

      minimumQuantity: 1,

      operationalWindow: 'IN_WINDOW',
    });

    expect(result.authorizationState).toBe('PENDING');

    expect(result.mipresState).toBe('UNLOCKED');

    expect(result.state).toBe('BLOCKED');
  });

  it('allows manual unlock when pending only because of future window', () => {
    const state = resolveMipresReadState({
      enablementStatus: 'ENABLED',

      tariffMembershipStatus: 'LISTED',

      coverageType: 'NO_PBS',

      directionStatus: 'CONFIRMED',

      manualDecision: 'PENDING_MANUAL_ENABLEMENT',

      quantity: 4,

      minimumQuantity: 1,

      operationalWindow: 'OUTSIDE_HORIZON',
    });

    expect(state.authorizationState).toBe('PENDING');

    expect(
      resolveMipresManualUnlockEligibility({
        authorizationState: state.authorizationState,

        operationalWindow: 'OUTSIDE_HORIZON',

        enablementStatus: 'ENABLED',

        tariffMembershipStatus: 'LISTED',

        coverageType: 'NO_PBS',

        directionStatus: 'CONFIRMED',
      }),
    ).toEqual({
      allowed: true,

      mode: 'PENDING_MANUAL_OVERRIDE',
    });
  });

  it('allows manual unlock while authorization remains pending', () => {
    const state = resolveMipresReadState({
      enablementStatus: 'ENABLED',

      tariffMembershipStatus: 'LISTED',

      coverageType: 'NO_PBS',

      directionStatus: 'PENDING',

      manualDecision: 'PENDING_MANUAL_ENABLEMENT',

      quantity: 4,

      minimumQuantity: 1,

      operationalWindow: 'IN_WINDOW',
    });

    expect(state.authorizationState).toBe('PENDING');

    expect(
      resolveMipresManualUnlockEligibility({
        authorizationState: state.authorizationState,

        operationalWindow: 'IN_WINDOW',

        enablementStatus: 'ENABLED',

        tariffMembershipStatus: 'LISTED',

        coverageType: 'NO_PBS',

        directionStatus: 'PENDING',
      }),
    ).toEqual({
      allowed: true,

      mode: 'PENDING_MANUAL_OVERRIDE',
    });
  });

  it('does not allow manual unlock for disabled authorization', () => {
    const state = resolveMipresReadState({
      enablementStatus: 'ENABLED',

      tariffMembershipStatus: 'LISTED',

      coverageType: 'NO_PBS',

      directionStatus: 'CONFIRMED',

      manualDecision: 'PENDING_MANUAL_ENABLEMENT',

      quantity: 4,

      minimumQuantity: 1,

      operationalWindow: 'EXPIRED',
    });

    expect(state.authorizationState).toBe('DISABLED');

    expect(
      resolveMipresManualUnlockEligibility({
        authorizationState: state.authorizationState,

        operationalWindow: 'EXPIRED',

        enablementStatus: 'ENABLED',

        tariffMembershipStatus: 'LISTED',

        coverageType: 'NO_PBS',

        directionStatus: 'CONFIRMED',
      }).allowed,
    ).toBe(false);
  });
});
