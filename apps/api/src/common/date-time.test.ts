
import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  toIsoTimestamp,
  toNullableIsoTimestamp,
} from './date-time';

describe(
  'database timestamp serialization',
  () => {
    it(
      'serializes Date values',
      () => {
        expect(
          toIsoTimestamp(
            new Date(
              '2026-09-18T19:43:00.846Z',
            ),
          ),
        ).toBe(
          '2026-09-18T19:43:00.846Z',
        );
      },
    );

    it(
      'serializes string values returned by raw database drivers',
      () => {
        expect(
          toIsoTimestamp(
            '2026-09-18T19:43:00.846Z',
          ),
        ).toBe(
          '2026-09-18T19:43:00.846Z',
        );
      },
    );

    it(
      'keeps nullable timestamps nullable',
      () => {
        expect(
          toNullableIsoTimestamp(
            null,
          ),
        ).toBeNull();
      },
    );

    it(
      'rejects invalid timestamps',
      () => {
        expect(
          () =>
            toIsoTimestamp(
              'not-a-date',
            ),
        ).toThrow(
          'Invalid database timestamp',
        );
      },
    );
  },
);
