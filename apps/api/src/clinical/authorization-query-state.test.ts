import { describe, expect, it } from 'vitest';

import {
  resolveAuthorizationAuditStatus,
  resolveAuthorizationFulfillmentStatus,
  resolveAuthorizationInitialValidationStatus,
  resolveAuthorizationValidityStatus,
} from './authorization-query-state';

describe('authorization query derived state', () => {
  describe('validity', () => {
    const today = '2026-09-25';

    it('accepts both limits inclusively', () => {
      expect(
        resolveAuthorizationValidityStatus({
          assignmentDate: '2026-10-25',
          validityEndDate: '2026-10-25',
          today,
        }),
      ).toBe('IN_WINDOW');

      expect(
        resolveAuthorizationValidityStatus({
          assignmentDate: '20260901',
          validityEndDate: '20260925',
          today,
        }),
      ).toBe('IN_WINDOW');
    });

    it('marks expired authorizations', () => {
      expect(
        resolveAuthorizationValidityStatus({
          assignmentDate: '2026-09-01',
          validityEndDate: '2026-09-24',
          today,
        }),
      ).toBe('EXPIRED');
    });

    it('marks assignment after today plus 30', () => {
      expect(
        resolveAuthorizationValidityStatus({
          assignmentDate: '2026-10-26',
          validityEndDate: '2026-11-30',
          today,
        }),
      ).toBe('OUTSIDE_HORIZON');
    });

    it.each([
      {
        assignmentDate: null,
        validityEndDate: '2026-10-30',
      },
      {
        assignmentDate: '2026-09-01',
        validityEndDate: null,
      },
      {
        assignmentDate: '2026-02-31',
        validityEndDate: '2026-10-30',
      },
      {
        assignmentDate: '2026-09-01',
        validityEndDate: '2026-13-01',
      },
    ])('marks invalid or absent source dates', ({ assignmentDate, validityEndDate }) => {
      expect(
        resolveAuthorizationValidityStatus({
          assignmentDate,
          validityEndDate,
          today,
        }),
      ).toBe('INVALID_DATE');
    });
  });

  describe('initial validation', () => {
    it('marks authorization as passed only when source, tariff and coverage validation are complete', () => {
      expect(
        resolveAuthorizationInitialValidationStatus({
          enablementStatus: 'ENABLED',
          tariffMembershipStatus: 'LISTED',
          coverageType: 'PBS',
          directionStatus: 'NOT_APPLICABLE',
        }),
      ).toBe('PASSED');

      expect(
        resolveAuthorizationInitialValidationStatus({
          enablementStatus: 'ENABLED',
          tariffMembershipStatus: 'LISTED',
          coverageType: 'NO_PBS',
          directionStatus: 'CONFIRMED',
        }),
      ).toBe('PASSED');
    });

    it('marks terminal initial failures', () => {
      expect(
        resolveAuthorizationInitialValidationStatus({
          enablementStatus: 'BLOCKED_SOURCE_STATUS',
          tariffMembershipStatus: 'LISTED',
          coverageType: 'PBS',
          directionStatus: 'NOT_APPLICABLE',
        }),
      ).toBe('FAILED');

      expect(
        resolveAuthorizationInitialValidationStatus({
          enablementStatus: 'ENABLED',
          tariffMembershipStatus: 'NOT_LISTED',
          coverageType: 'PBS',
          directionStatus: 'NOT_APPLICABLE',
        }),
      ).toBe('FAILED');
    });

    it('keeps unfinished tariff or MIPRES checks pending', () => {
      expect(
        resolveAuthorizationInitialValidationStatus({
          enablementStatus: 'ENABLED',
          tariffMembershipStatus: 'NOT_EVALUATED',
          coverageType: 'PBS',
          directionStatus: 'NOT_APPLICABLE',
        }),
      ).toBe('PENDING');

      expect(
        resolveAuthorizationInitialValidationStatus({
          enablementStatus: 'ENABLED',
          tariffMembershipStatus: 'LISTED',
          coverageType: 'NO_PBS',
          directionStatus: 'PENDING',
        }),
      ).toBe('PENDING');
    });
  });

  it('marca como fallida la validación inicial cuando CANTIDAD es menor al producto mínimo', () => {
    expect(
      resolveAuthorizationInitialValidationStatus({
        enablementStatus:
          'ENABLED',

        tariffMembershipStatus:
          'LISTED',

        coverageType:
          'PBS',

        directionStatus:
          'NOT_APPLICABLE',

        quantity:
          29,

        minimumQuantity:
          30,
      }),
    ).toBe(
      'FAILED',
    );

    expect(
      resolveAuthorizationInitialValidationStatus({
        enablementStatus:
          'ENABLED',

        tariffMembershipStatus:
          'LISTED',

        coverageType:
          'PBS',

        directionStatus:
          'NOT_APPLICABLE',

        quantity:
          30,

        minimumQuantity:
          30,
      }),
    ).toBe(
      'PASSED',
    );
  });


  describe('fulfillment', () => {
    it('maps delivery, application and pending', () => {
      expect(resolveAuthorizationFulfillmentStatus('DELIVERY')).toBe('DELIVERED');

      expect(resolveAuthorizationFulfillmentStatus('APPLICATION')).toBe('APPLIED');

      expect(resolveAuthorizationFulfillmentStatus(null)).toBe('PENDING');
    });
  });

  describe('audit', () => {
    it('maps persisted audit decisions', () => {
      expect(resolveAuthorizationAuditStatus('IN_REVIEW')).toBe('IN_REVIEW');

      expect(resolveAuthorizationAuditStatus('APPROVED')).toBe('APPROVED');

      expect(resolveAuthorizationAuditStatus('REJECTED')).toBe('REJECTED');

      expect(resolveAuthorizationAuditStatus(null)).toBe('PENDING');

      expect(resolveAuthorizationAuditStatus('READY_FOR_AUDIT')).toBe('PENDING');
    });
  });
});
