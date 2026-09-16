import { describe, expect, it } from 'vitest';
import {
  calculateNextSlot,
  countMissedSlots,
  deriveRunHealth,
  evaluateHealthAlert,
  getZonedDate,
  getZonedParts,
  isComparableScope,
  parseLocalTime,
  shouldEmitRecovery,
} from './reconciliation-operations';

describe('reconciliation-operations domain', () => {
  it('parses valid local times and rejects invalid', () => {
    expect(parseLocalTime('02:00')).toEqual({ hour: 2, minute: 0 });
    expect(parseLocalTime('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseLocalTime('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(() => parseLocalTime('24:00')).toThrow(/INVALID_LOCAL_TIME/);
    expect(() => parseLocalTime('02:60')).toThrow(/INVALID_LOCAL_TIME/);
    expect(() => parseLocalTime('abc')).toThrow(/INVALID_LOCAL_TIME/);
  });

  it('calculates zoned date correctly in America/Bogota', () => {
    // 2026-09-15 02:00 America/Bogota is UTC-5 -> 2026-09-15 07:00:00Z
    const d = getZonedDate(2026, 9, 15, 2, 0, 'America/Bogota');
    expect(d.toISOString()).toBe('2026-09-15T07:00:00.000Z');

    const parts = getZonedParts(d, 'America/Bogota');
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(9);
    expect(parts.day).toBe(15);
    expect(parts.hour).toBe(2);
    expect(parts.minute).toBe(0);
    expect(parts.weekday).toBe(2); // Tuesday
  });

  it('calculates next slot for DAILY policy', () => {
    // Reference: 2026-09-15 01:00 Bogota (06:00 UTC)
    const ref = new Date('2026-09-15T06:00:00.000Z');
    const slot = calculateNextSlot(
      { cadence: 'DAILY', localTime: '02:00', timezone: 'America/Bogota' },
      ref,
    );
    expect(slot).not.toBeNull();
    // Same day at 02:00 Bogota (07:00 UTC)
    expect(slot?.toISOString()).toBe('2026-09-15T07:00:00.000Z');

    // Reference: 2026-09-15 03:00 Bogota (08:00 UTC) -> should be tomorrow
    const refAfter = new Date('2026-09-15T08:00:00.000Z');
    const slotTomorrow = calculateNextSlot(
      { cadence: 'DAILY', localTime: '02:00', timezone: 'America/Bogota' },
      refAfter,
    );
    expect(slotTomorrow?.toISOString()).toBe('2026-09-16T07:00:00.000Z');
  });

  it('calculates next slot for WEEKLY policy', () => {
    // 2026-09-15 is Tuesday (weekday 2).
    // Target weekday 4 (Thursday) at 03:00 Bogota
    const ref = new Date('2026-09-15T06:00:00.000Z');
    const slotThursday = calculateNextSlot(
      { cadence: 'WEEKLY', localTime: '03:00', weekday: 4, timezone: 'America/Bogota' },
      ref,
    );
    expect(slotThursday).not.toBeNull();
    const parts = getZonedParts(slotThursday!, 'America/Bogota');
    expect(parts.day).toBe(17); // 2026-09-17 Thursday
    expect(parts.hour).toBe(3);
    expect(parts.weekday).toBe(4);
  });

  it('returns null for MANUAL policy', () => {
    expect(calculateNextSlot({ cadence: 'MANUAL', localTime: '02:00' })).toBeNull();
  });

  it('counts missed slots between last slot and now', () => {
    const policy = { cadence: 'DAILY' as const, localTime: '02:00', timezone: 'America/Bogota' };
    const slot1 = new Date('2026-09-10T07:00:00.000Z');
    const now = new Date('2026-09-15T12:00:00.000Z'); // 5 days later
    const missed = countMissedSlots(policy, slot1, now);
    expect(missed).toBe(5);
  });

  it('derives run health according to ESP-017 standard', () => {
    expect(deriveRunHealth(0, 0)).toBe('HEALTHY');
    expect(deriveRunHealth(1, 0)).toBe('UNHEALTHY');
    expect(deriveRunHealth(0, 2)).toBe('UNHEALTHY');
  });

  it('evaluates health alert threshold correctly', () => {
    // NONE suppresses
    expect(
      evaluateHealthAlert({
        threshold: 'NONE',
        criticalFindings: 2,
        errorFindings: 1,
        warningFindings: 5,
      }).shouldAlert,
    ).toBe(false);

    // CRITICAL threshold triggers on critical only
    const critRes = evaluateHealthAlert({
      threshold: 'CRITICAL',
      criticalFindings: 1,
      errorFindings: 3,
      warningFindings: 0,
    });
    expect(critRes.shouldAlert).toBe(true);
    expect(critRes.notificationType).toBe('RECONCILIATION_CRITICAL');

    const critIgnoreError = evaluateHealthAlert({
      threshold: 'CRITICAL',
      criticalFindings: 0,
      errorFindings: 3,
      warningFindings: 0,
    });
    expect(critIgnoreError.shouldAlert).toBe(false);

    // ERROR threshold triggers on error or critical
    const errRes = evaluateHealthAlert({
      threshold: 'ERROR',
      criticalFindings: 0,
      errorFindings: 2,
      warningFindings: 1,
    });
    expect(errRes.shouldAlert).toBe(true);
    expect(errRes.notificationType).toBe('RECONCILIATION_ERROR');

    // WARNING threshold triggers on warning
    const warnRes = evaluateHealthAlert({
      threshold: 'WARNING',
      criticalFindings: 0,
      errorFindings: 0,
      warningFindings: 1,
    });
    expect(warnRes.shouldAlert).toBe(true);
    expect(warnRes.notificationType).toBe('RECONCILIATION_WARNING');
  });

  it('evaluates recovery conditions without false spam', () => {
    const scopeA = { kind: 'GLOBAL', domains: ['SCHEDULING'] };
    const scopeB = { kind: 'GLOBAL', domains: ['SCHEDULING'] };
    const scopeOther = { kind: 'GLOBAL', domains: ['APPLICATION'] };

    expect(isComparableScope(scopeA, scopeB)).toBe(true);
    expect(isComparableScope(scopeA, scopeOther)).toBe(false);

    // Unhealthy -> Healthy => Recovery!
    expect(
      shouldEmitRecovery(
        { notifyOnRecovery: true },
        { criticalFindings: 1, errorFindings: 0, scope: scopeA },
        { criticalFindings: 0, errorFindings: 0, scope: scopeB },
      ),
    ).toBe(true);

    // Healthy -> Healthy => No recovery (no spam)
    expect(
      shouldEmitRecovery(
        { notifyOnRecovery: true },
        { criticalFindings: 0, errorFindings: 0, scope: scopeA },
        { criticalFindings: 0, errorFindings: 0, scope: scopeB },
      ),
    ).toBe(false);

    // Incomparable scope => No recovery
    expect(
      shouldEmitRecovery(
        { notifyOnRecovery: true },
        { criticalFindings: 1, errorFindings: 0, scope: scopeA },
        { criticalFindings: 0, errorFindings: 0, scope: scopeOther },
      ),
    ).toBe(false);

    // notifyOnRecovery false => No recovery
    expect(
      shouldEmitRecovery(
        { notifyOnRecovery: false },
        { criticalFindings: 1, errorFindings: 0, scope: scopeA },
        { criticalFindings: 0, errorFindings: 0, scope: scopeB },
      ),
    ).toBe(false);
  });
});
