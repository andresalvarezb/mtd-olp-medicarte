import { describe, expect, it } from 'vitest';

import {
  AuthorizationFulfillmentError,
  assertAuthorizationFulfillment,
} from './authorization-fulfillment';

const base = {
  effectiveDate: '2026-09-15',
  validityEndDate: '2026-09-15',
  todayBogota: '2026-09-22',
  assignedQuantity: 1,
  pointCount: 1,
  alreadyClosed: false,
} as const;

describe('authorization fulfillment', () => {
  it('permite registrar hoy una dispensación histórica dentro de la vigencia', () => {
    expect(() =>
      assertAuthorizationFulfillment(base),
    ).not.toThrow();
  });

  it('permite el mismo día del vencimiento', () => {
    expect(() =>
      assertAuthorizationFulfillment({
        ...base,
        effectiveDate: '2026-09-15',
      }),
    ).not.toThrow();
  });

  it('rechaza una fecha posterior al vencimiento', () => {
    expect(() =>
      assertAuthorizationFulfillment({
        ...base,
        effectiveDate: '2026-09-16',
      }),
    ).toThrowError(AuthorizationFulfillmentError);
  });

  it('rechaza una fecha futura', () => {
    expect(() =>
      assertAuthorizationFulfillment({
        ...base,
        effectiveDate: '2026-09-23',
        validityEndDate: '2026-09-30',
      }),
    ).toThrowError(AuthorizationFulfillmentError);
  });

  it('requiere inventario asignado', () => {
    expect(() =>
      assertAuthorizationFulfillment({
        ...base,
        assignedQuantity: 0,
      }),
    ).toThrowError(AuthorizationFulfillmentError);
  });

  it('requiere un solo punto operacional', () => {
    expect(() =>
      assertAuthorizationFulfillment({
        ...base,
        pointCount: 2,
      }),
    ).toThrowError(AuthorizationFulfillmentError);
  });

  it('no permite cerrar dos veces la misma autorización', () => {
    expect(() =>
      assertAuthorizationFulfillment({
        ...base,
        alreadyClosed: true,
      }),
    ).toThrowError(AuthorizationFulfillmentError);
  });
});
