import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_ANNULMENT_EVIDENCE_KEY,
  authorizationAnnulmentBlock,
  isAuthorizationAnnulled,
} from './authorization-annulment';

describe('BR-AUTO-ANNUL-001', () => {
  const empty = {
    alreadyAnnulled: false,
    hasFulfillment: false,
    hasConfirmedApplication: false,
    hasInventoryConsumption: false,
  };
  it('permite anular con OC o reservas sin consumo', () => {
    expect(authorizationAnnulmentBlock(empty)).toBeNull();
  });
  it.each(['hasFulfillment', 'hasConfirmedApplication', 'hasInventoryConsumption'] as const)(
    'bloquea con cualquier %s', (field) => {
      expect(authorizationAnnulmentBlock({ ...empty, [field]: true })).toBe('AUTHORIZATION_ALREADY_ATTENDED');
    },
  );
  it('no permite anular dos veces', () => {
    expect(authorizationAnnulmentBlock({ ...empty, alreadyAnnulled: true })).toBe('AUTHORIZATION_ALREADY_ANNULLED');
  });
  it('la marca persiste independientemente del estado fuente', () => {
    expect(isAuthorizationAnnulled({ [AUTHORIZATION_ANNULMENT_EVIDENCE_KEY]: { reason: 'Prueba' } })).toBe(true);
    expect(isAuthorizationAnnulled({ ESTADO_AUTORIZACION: '5' })).toBe(false);
  });
});
