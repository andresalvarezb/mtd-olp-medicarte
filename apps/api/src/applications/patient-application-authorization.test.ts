import { describe, expect, it } from 'vitest';
import { evaluatePatientApplicationAuthorization } from './patient-application-authorization';

const TODAY = '2031-03-10';

const base = {
  enablementStatus: 'ENABLED',
  coverageType: 'PBS',
  directionStatus: 'NOT_APPLICABLE',
  assignmentDate: TODAY,
  expirationDate: '2031-12-31',
  todayBogota: TODAY,
};

describe('patient application authorization eligibility', () => {
  it('allows an enabled authorization inside the operational window', () => {
    expect(
      evaluatePatientApplicationAuthorization(base),
    ).toEqual({
      eligible: true,
      code: null,
    });
  });

  it('allows assignment exactly on today plus 30', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        assignmentDate: '2031-04-09',
      }),
    ).toEqual({
      eligible: true,
      code: null,
    });
  });

  it('blocks assignment on today plus 31', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        assignmentDate: '2031-04-10',
      }),
    ).toEqual({
      eligible: false,
      code: 'PATIENT_APPLICATION_AUTHORIZATION_NOT_ELIGIBLE',
    });
  });

  it('blocks expired authorization', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        expirationDate: '2031-03-01',
      }),
    ).toEqual({
      eligible: false,
      code: 'AUTHORIZATION_EXPIRED',
    });
  });

  it('blocks missing assignment date', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        assignmentDate: null,
      }),
    ).toEqual({
      eligible: false,
      code: 'PATIENT_APPLICATION_AUTHORIZATION_NOT_ELIGIBLE',
    });
  });

  it('blocks invalid assignment date', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        assignmentDate: 'INVALID',
      }),
    ).toEqual({
      eligible: false,
      code: 'PATIENT_APPLICATION_AUTHORIZATION_NOT_ELIGIBLE',
    });
  });

  it('blocks missing expiration date for application', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        expirationDate: null,
      }),
    ).toEqual({
      eligible: false,
      code: 'PATIENT_APPLICATION_AUTHORIZATION_NOT_ELIGIBLE',
    });
  });

  it('preserves blocked authorization clinical rule', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        enablementStatus: 'BLOCKED_SOURCE_STATUS',
      }),
    ).toEqual({
      eligible: false,
      code: 'AUTHORIZATION_NOT_SCHEDULABLE',
    });
  });

  it('preserves NO_PBS direction rule', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        coverageType: 'NO_PBS',
        directionStatus: 'PENDING',
      }),
    ).toEqual({
      eligible: false,
      code: 'AUTHORIZATION_NOT_SCHEDULABLE',
    });
  });

  it('allows NO_PBS with confirmed direction', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        coverageType: 'NO_PBS',
        directionStatus: 'CONFIRMED',
      }),
    ).toEqual({
      eligible: true,
      code: null,
    });
  });

  it('blocks application after authorization expiration', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        expirationDate: '2031-04-20',
        applicationDate: '2031-04-21',
      }),
    ).toEqual({
      eligible: false,
      code: 'PATIENT_APPLICATION_AUTHORIZATION_EXPIRED',
    });
  });

  it('allows application exactly on expiration date', () => {
    expect(
      evaluatePatientApplicationAuthorization({
        ...base,
        expirationDate: '2031-04-20',
        applicationDate: '2031-04-20',
      }),
    ).toEqual({
      eligible: true,
      code: null,
    });
  });
});
