import { describe, expect, it } from 'vitest';
import {
  clinicalAuthorizationReferenceSchema,
  foundationJobSchema,
  legacyAuthorizationHistoryResponseSchema,
  loginRequestSchema,
  usernameSchema,
} from './index';

describe('foundation contracts', () => {
  it('requires a versioned event', () => {
    expect(() => foundationJobSchema.parse({ name: 'foundation.event' })).toThrow();
  });

  it('normalizes usernames before validation', () => {
    expect(usernameSchema.parse(' Admin.User ')).toBe('admin.user');
    expect(loginRequestSchema.safeParse({ username: 'admin', password: '' }).success).toBe(false);
  });

  it('separates clinical references from legacy operational history', () => {
    expect(
      clinicalAuthorizationReferenceSchema.parse({
        authorizationItemId: '10000000-0000-4000-8000-000000000001',
        commercialCode: ' cod001 ',
      }),
    ).toEqual({
      authorizationItemId: '10000000-0000-4000-8000-000000000001',
      commercialCode: 'COD001',
    });
    expect(
      legacyAuthorizationHistoryResponseSchema.safeParse({
        id: '10000000-0000-4000-8000-000000000001',
        numeroAutorizacion: 'AUTH-1',
        commercialCode: 'COD001',
        lugarDispensacion: null,
        fechaProgramada: null,
        fechaDispensacion: null,
        fechaAplicacion: null,
        codAutorizacionMedicarte: null,
        ordenCompra: 'LEGACY-1',
        processStatus: null,
        operationStatus: null,
        operationalVersion: 0,
        updatedAt: '2026-09-13T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
