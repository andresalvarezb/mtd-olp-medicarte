import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  authorizationQueryValidityWindow,
} from './authorization-query-validity';


describe(
  'authorization query validity window',
  () => {
    it(
      'usa la fecha calendario de Bogota y suma 30 dias',
      () => {
        const result =
          authorizationQueryValidityWindow(
            new Date(
              '2026-09-25T04:30:00.000Z',
            ),
          );

        expect(
          result,
        ).toEqual({
          today:
            '2026-09-24',

          horizon:
            '2026-10-24',
        });
      },
    );


    it(
      'cruza mes y anio sin depender de la zona UTC',
      () => {
        const result =
          authorizationQueryValidityWindow(
            new Date(
              '2026-12-15T17:00:00.000Z',
            ),
          );

        expect(
          result,
        ).toEqual({
          today:
            '2026-12-15',

          horizon:
            '2027-01-14',
        });
      },
    );
  },
);
