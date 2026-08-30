import { describe, expect, it } from 'vitest';
import {
  deriveApplicationSiteStatus,
  evaluateOperationalFieldTransition,
  isValidOperationalText,
  normalizeOperationalText,
} from './operational';

describe('normalizeOperationalText', () => {
  it('recorta y colapsa espacios internos', () => {
    expect(normalizeOperationalText('  Calle   123   #45-67 ')).toBe('Calle 123 #45-67');
  });

  it('convierte valores nulos en cadena vacía', () => {
    expect(normalizeOperationalText(null)).toBe('');
    expect(normalizeOperationalText(undefined)).toBe('');
    expect(normalizeOperationalText(42)).toBe('42');
  });

  it('preserva el caso original (texto libre del negocio)', () => {
    expect(normalizeOperationalText('Drogadería Principal')).toBe('Drogadería Principal');
  });
});

describe('isValidOperationalText', () => {
  it('rechaza vacío y acepta valores razonables', () => {
    expect(isValidOperationalText('')).toBe(false);
    expect(isValidOperationalText('   ')).toBe(false);
    expect(isValidOperationalText('Calle 123')).toBe(true);
    expect(isValidOperationalText('x'.repeat(501))).toBe(false);
    expect(isValidOperationalText('x'.repeat(500))).toBe(true);
  });
});

describe('deriveApplicationSiteStatus', () => {
  it('deriva PENDING_ASSIGNMENT cuando no hay lugar', () => {
    expect(deriveApplicationSiteStatus(null)).toBe('PENDING_ASSIGNMENT');
    expect(deriveApplicationSiteStatus('')).toBe('PENDING_ASSIGNMENT');
  });

  it('deriva ASSIGNED cuando hay lugar', () => {
    expect(deriveApplicationSiteStatus('Calle 123')).toBe('ASSIGNED');
  });
});

describe('evaluateOperationalFieldTransition', () => {
  it('primera asignación produce ASSIGNED y aumenta la versión', () => {
    const transition = evaluateOperationalFieldTransition(null, 'Calle 123', 3);
    expect(transition.eventType).toBe('DISPENSATION_LOCATION_ASSIGNED');
    expect(transition.newVersion).toBe(4);
    expect(transition.previousValue).toBeNull();
  });

  it('cambio real produce CHANGED y aumenta la versión', () => {
    const transition = evaluateOperationalFieldTransition('Calle 123', 'Carrera 45', 4);
    expect(transition.eventType).toBe('DISPENSATION_LOCATION_CHANGED');
    expect(transition.newVersion).toBe(5);
  });

  it('un valor idéntico no emite evento ni versión nueva', () => {
    const transition = evaluateOperationalFieldTransition('Calle 123', 'Calle 123', 4);
    expect(transition.eventType).toBeNull();
    expect(transition.newVersion).toBe(4);
  });
});
