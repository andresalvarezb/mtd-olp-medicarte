import { describe, expect, it } from 'vitest';
import { SCHEDULE_EXPIRATION_THRESHOLDS } from '@authorization/contracts';
import {
  PatientScheduleLateHandlingError,
  PatientScheduleTransitionError,
  assertLateHandling,
  assertPatientScheduleTransition,
  calculateAuthorizationPriority,
  canTransitionPatientSchedule,
  evaluateScheduleAuthorizationEligibility,
  parseAuthorizationExpiration,
  requiresLateHandling,
  type ScheduleExpirationPolicy,
} from './patient-schedule';

const TODAY = '2031-03-10';

describe('patient schedule state machine', () => {
  it('allows reschedule and cancellation but not resurrection', () => {
    expect(canTransitionPatientSchedule('SCHEDULED', 'RESCHEDULED')).toBe(true);
    expect(canTransitionPatientSchedule('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(canTransitionPatientSchedule('RESCHEDULED', 'RESCHEDULED')).toBe(true);
    expect(canTransitionPatientSchedule('RESCHEDULED', 'CANCELLED')).toBe(true);
    expect(canTransitionPatientSchedule('CANCELLED', 'RESCHEDULED')).toBe(false);
    expect(canTransitionPatientSchedule('CANCELLED', 'CANCELLED')).toBe(false);
    expect(canTransitionPatientSchedule('SCHEDULED', 'SCHEDULED')).toBe(false);
  });

  it('throws on an invalid transition', () => {
    expect(() => assertPatientScheduleTransition('CANCELLED', 'RESCHEDULED')).toThrow(
      PatientScheduleTransitionError,
    );
    expect(() => assertPatientScheduleTransition('SCHEDULED', 'CANCELLED')).not.toThrow();
  });
});

describe('late handling', () => {
  it('requires an explicit decision for LATE schedules', () => {
    expect(requiresLateHandling('LATE')).toBe(true);
    expect(requiresLateHandling('ON_TIME')).toBe(false);
    expect(() => assertLateHandling('LATE', null)).toThrow(PatientScheduleLateHandlingError);
    expect(() => assertLateHandling('LATE', undefined)).toThrow(PatientScheduleLateHandlingError);
    expect(() => assertLateHandling('LATE', 'COMPLEMENTARY_PURCHASE_ORDER')).not.toThrow();
    expect(() => assertLateHandling('LATE', 'NEXT_PERIOD')).not.toThrow();
  });

  it('rejects late handling on on-time schedules', () => {
    expect(() => assertLateHandling('ON_TIME', 'NEXT_PERIOD')).toThrow(
      PatientScheduleLateHandlingError,
    );
    expect(() => assertLateHandling('ON_TIME', null)).not.toThrow();
  });
});

describe('authorization expiration priority', () => {
  it('parses compact and ISO expiration formats', () => {
    expect(parseAuthorizationExpiration('20310325')).toBe('2031-03-25');
    expect(parseAuthorizationExpiration('2031-03-25')).toBe('2031-03-25');
    expect(parseAuthorizationExpiration('2031-03-25T00:00:00Z')).toBe('2031-03-25');
    expect(parseAuthorizationExpiration('')).toBeNull();
    expect(parseAuthorizationExpiration(null)).toBeNull();
    expect(parseAuthorizationExpiration(undefined)).toBeNull();
  });

  it('classifies with the default operational policy: <=15 CRITICAL, <=30 HIGH, else NORMAL', () => {
    const priority = (expiration: string) =>
      calculateAuthorizationPriority(expiration, TODAY, SCHEDULE_EXPIRATION_THRESHOLDS);
    expect(priority('2031-03-25')).toEqual({ daysUntilExpiration: 15, priorityLevel: 'CRITICAL' });
    expect(priority('2031-03-26')).toEqual({ daysUntilExpiration: 16, priorityLevel: 'HIGH' });
    expect(priority('2031-04-09')).toEqual({ daysUntilExpiration: 30, priorityLevel: 'HIGH' });
    expect(priority('2031-04-10')).toEqual({ daysUntilExpiration: 31, priorityLevel: 'NORMAL' });
    expect(calculateAuthorizationPriority(null, TODAY)).toEqual({
      daysUntilExpiration: null,
      priorityLevel: null,
    });
  });

  it('uses the default policy when none is passed', () => {
    expect(calculateAuthorizationPriority('2031-03-25', TODAY)).toEqual({
      daysUntilExpiration: 15,
      priorityLevel: 'CRITICAL',
    });
  });

  it('changing the policy changes the classification without modifying the domain', () => {
    const tighten: ScheduleExpirationPolicy = { criticalDays: 2, highDays: 5 };
    const loosen: ScheduleExpirationPolicy = { criticalDays: 20, highDays: 40 };

    // Con la política ajustada, el mismo día cae en NORMAL; con la relajada en CRITICAL.
    expect(calculateAuthorizationPriority('2031-03-25', TODAY, tighten).priorityLevel).toBe(
      'NORMAL',
    );
    expect(calculateAuthorizationPriority('2031-03-25', TODAY, loosen).priorityLevel).toBe(
      'CRITICAL',
    );
    expect(calculateAuthorizationPriority('2031-03-12', TODAY, tighten)).toEqual({
      daysUntilExpiration: 2,
      priorityLevel: 'CRITICAL',
    });
    expect(calculateAuthorizationPriority('2031-03-14', TODAY, tighten).priorityLevel).toBe('HIGH');
    expect(calculateAuthorizationPriority('2031-03-16', TODAY, tighten).priorityLevel).toBe(
      'NORMAL',
    );
    // La fuente única de configuración no es mutable.
    expect(SCHEDULE_EXPIRATION_THRESHOLDS).toEqual({ criticalDays: 15, highDays: 30 });
  });

  it('reports already-expired authorizations as CRITICAL (still a visual alert)', () => {
    expect(calculateAuthorizationPriority('2031-03-01', TODAY)).toEqual({
      daysUntilExpiration: -9,
      priorityLevel: 'CRITICAL',
    });
  });
});

describe('authorization eligibility for scheduling', () => {
  const base = {
    enablementStatus: 'ENABLED',
    coverageType: 'PBS',
    directionStatus: 'NOT_APPLICABLE',
    expirationDate: '2031-12-31',
    todayBogota: TODAY,
  };

  it('accepts an enabled, vigente PBS authorization', () => {
    expect(evaluateScheduleAuthorizationEligibility(base)).toEqual({
      eligible: true,
      code: null,
      message: null,
    });
  });

  it('accepts an enabled NO_PBS authorization with confirmed direction', () => {
    expect(
      evaluateScheduleAuthorizationEligibility({
        ...base,
        coverageType: 'NO_PBS',
        directionStatus: 'CONFIRMED',
      }).eligible,
    ).toBe(true);
  });

  it('rejects blocked, expired and wrong-direction authorizations', () => {
    expect(
      evaluateScheduleAuthorizationEligibility({
        ...base,
        enablementStatus: 'BLOCKED_SOURCE_STATUS',
      }),
    ).toMatchObject({ eligible: false, code: 'AUTHORIZATION_NOT_SCHEDULABLE' });
    expect(
      evaluateScheduleAuthorizationEligibility({ ...base, expirationDate: '2031-03-01' }),
    ).toMatchObject({ eligible: false, code: 'AUTHORIZATION_EXPIRED' });
    expect(
      evaluateScheduleAuthorizationEligibility({
        ...base,
        coverageType: 'NO_PBS',
        directionStatus: 'PENDING',
      }),
    ).toMatchObject({ eligible: false, code: 'AUTHORIZATION_NOT_SCHEDULABLE' });
    expect(
      evaluateScheduleAuthorizationEligibility({ ...base, directionStatus: 'CONFIRMED' }),
    ).toMatchObject({ eligible: false, code: 'AUTHORIZATION_NOT_SCHEDULABLE' });
  });

  it('does not block an enabled authorization without expiration data', () => {
    expect(evaluateScheduleAuthorizationEligibility({ ...base, expirationDate: null }).eligible).toBe(
      true,
    );
  });
});
