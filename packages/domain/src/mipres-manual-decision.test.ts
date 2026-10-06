import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  evaluateEffectiveMipresEligibility,
  normalizeMipresManualDecision,
} from './mipres-manual-decision';


describe(
  'MIPRES manual operational decision',
  () => {
    it(
      'keeps confirmed official MIPRES blocked while manual enablement is pending',
      () => {
        expect(
          evaluateEffectiveMipresEligibility({
            coverageType:
              'NO_PBS',

            directionStatus:
              'CONFIRMED',

            manualDecision:
              'PENDING_MANUAL_ENABLEMENT',
          }),
        ).toEqual({
          eligible:
            false,

          source:
            'PENDING_MANUAL_ENABLEMENT',
        });
      },
    );


    it(
      'defaults missing decision to pending manual enablement',
      () => {
        expect(
          evaluateEffectiveMipresEligibility({
            coverageType:
              'NO_PBS',

            directionStatus:
              'CONFIRMED',
          }),
        ).toEqual({
          eligible:
            false,

          source:
            'PENDING_MANUAL_ENABLEMENT',
        });
      },
    );


    it(
      'allows explicit manual enablement without rewriting official evidence',
      () => {
        expect(
          evaluateEffectiveMipresEligibility({
            coverageType:
              'NO_PBS',

            directionStatus:
              'PENDING',

            manualDecision:
              'MANUALLY_ENABLED',
          }),
        ).toEqual({
          eligible:
            true,

          source:
            'MANUAL_ENABLE',
        });
      },
    );


    it(
      'allows explicit manual enablement during MIPRES query error',
      () => {
        expect(
          evaluateEffectiveMipresEligibility({
            coverageType:
              'NO_PBS',

            directionStatus:
              'QUERY_ERROR',

            manualDecision:
              'MANUALLY_ENABLED',
          }),
        ).toEqual({
          eligible:
            true,

          source:
            'MANUAL_ENABLE',
        });
      },
    );


    it(
      'manual disable wins over confirmed official direction',
      () => {
        expect(
          evaluateEffectiveMipresEligibility({
            coverageType:
              'NO_PBS',

            directionStatus:
              'CONFIRMED',

            manualDecision:
              'MANUALLY_DISABLED',
          }),
        ).toEqual({
          eligible:
            false,

          source:
            'MANUAL_DISABLE',
        });
      },
    );


    it(
      'keeps PBS independent from MIPRES evidence and manual decisions',
      () => {
        expect(
          evaluateEffectiveMipresEligibility({
            coverageType:
              'PBS',

            directionStatus:
              'QUERY_ERROR',

            manualDecision:
              'MANUALLY_DISABLED',
          }),
        ).toEqual({
          eligible:
            true,

          source:
            'NOT_APPLICABLE',
        });
      },
    );


    it(
      'does not enable unclassified coverage through MIPRES manual control',
      () => {
        expect(
          evaluateEffectiveMipresEligibility({
            coverageType:
              'UNCLASSIFIED',

            directionStatus:
              'PENDING',

            manualDecision:
              'MANUALLY_ENABLED',
          }),
        ).toEqual({
          eligible:
            false,

          source:
            'COVERAGE_NOT_APPLICABLE',
        });
      },
    );


    it(
      'normalizes historical or unknown values to pending manual enablement',
      () => {
        expect(
          normalizeMipresManualDecision(
            'UNKNOWN',
          ),
        ).toBe(
          'PENDING_MANUAL_ENABLEMENT',
        );

        expect(
          normalizeMipresManualDecision(
            null,
          ),
        ).toBe(
          'PENDING_MANUAL_ENABLEMENT',
        );

        expect(
          normalizeMipresManualDecision(
            undefined,
          ),
        ).toBe(
          'PENDING_MANUAL_ENABLEMENT',
        );
      },
    );
  },
);
