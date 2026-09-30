import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveAuthorizationLifecycleStatus,
} from './authorization-query-state';


describe(
  'authorization query lifecycle status',
  () => {
    it(
      'habilita cuando validación y vigencia cumplen',
      () => {
        expect(
          resolveAuthorizationLifecycleStatus({
            initialValidationStatus:
              'PASSED',

            validityStatus:
              'IN_WINDOW',
          }),
        ).toBe(
          'ENABLED',
        );
      },
    );

    it(
      'deja pendiente una validación pendiente dentro de rango',
      () => {
        expect(
          resolveAuthorizationLifecycleStatus({
            initialValidationStatus:
              'PENDING',

            validityStatus:
              'IN_WINDOW',
          }),
        ).toBe(
          'PENDING',
        );
      },
    );

    it(
      'deja pendiente una AUTO válida fuera del horizonte +30',
      () => {
        expect(
          resolveAuthorizationLifecycleStatus({
            initialValidationStatus:
              'PASSED',

            validityStatus:
              'OUTSIDE_HORIZON',
          }),
        ).toBe(
          'PENDING',
        );
      },
    );

    it(
      'inhabilita una validación fallida',
      () => {
        expect(
          resolveAuthorizationLifecycleStatus({
            initialValidationStatus:
              'FAILED',

            validityStatus:
              'IN_WINDOW',
          }),
        ).toBe(
          'DISABLED',
        );
      },
    );

    it(
      'mantiene operable una autorización vencida',
      () => {
        expect(
          resolveAuthorizationLifecycleStatus({
            initialValidationStatus:
              'PASSED',

            validityStatus:
              'EXPIRED',
          }),
        ).toBe(
          'DISABLED',
        );
      },
    );

    it(
      'fecha inválida tiene precedencia sobre validación pendiente',
      () => {
        expect(
          resolveAuthorizationLifecycleStatus({
            initialValidationStatus:
              'PENDING',

            validityStatus:
              'INVALID_DATE',
          }),
        ).toBe(
          'DISABLED',
        );
      },
    );

    it(
      'vencimiento tiene precedencia sobre validación pendiente',
      () => {
        expect(
          resolveAuthorizationLifecycleStatus({
            initialValidationStatus:
              'PENDING',

            validityStatus:
              'EXPIRED',
          }),
        ).toBe(
          'DISABLED',
        );
      },
    );
  },
);
