import { describe, expect, it } from 'vitest';
import {
  deriveApplicationSiteStatus,
  evaluateOperationalFieldTransition,
  isValidOperationalText,
  isValidOperationalDate,
  isOperationalUpdateAllowed,
  deriveOperationalStatuses,
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

describe('operational dates', () => {
  it('acepta únicamente fechas calendario canónicas válidas', () => {
    expect(isValidOperationalDate('2026-02-28')).toBe(true);
    expect(isValidOperationalDate('2026-02-29')).toBe(false);
    expect(isValidOperationalDate('28/02/2026')).toBe(false);
  });

  it('exige lugar y estados permitidos para cada operación', () => {
    expect(
      isOperationalUpdateAllowed({
        operationType: 'REPORT_DISPENSATION_DATE',
        operationStatus: 'LISTO_PARA_DISPENSAR',
        auditStatus: 'NO_INICIADO',
        lugarDispensacion: 'Sede norte',
      }),
    ).toBe(true);
    expect(
      isOperationalUpdateAllowed({
        operationType: 'REPORT_APPLICATION_DATE',
        operationStatus: 'DISPENSACION_REPORTADA',
        auditStatus: 'APROBADO',
        lugarDispensacion: 'Sede norte',
      }),
    ).toBe(false);
  });

  it('reporta dispensación y habilita revisión con ambas fechas sin dispensar', () => {
    expect(
      deriveOperationalStatuses({
        operationType: 'REPORT_DISPENSATION_DATE',
        operationStatus: 'LISTO_PARA_DISPENSAR',
        auditStatus: 'NO_INICIADO',
        fechaDispensacion: null,
        fechaAplicacion: '2026-08-30',
        newValue: '2026-08-29',
      }),
    ).toEqual({ operationStatus: 'DISPENSACION_REPORTADA', auditStatus: 'LISTO' });
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
  it('deriva PENDIENTE_ASIGNACION cuando no hay lugar', () => {
    expect(deriveApplicationSiteStatus(null)).toBe('PENDIENTE_ASIGNACION');
    expect(deriveApplicationSiteStatus('')).toBe('PENDIENTE_ASIGNACION');
  });

  it('deriva ASIGNADO cuando hay lugar', () => {
    expect(deriveApplicationSiteStatus('Calle 123')).toBe('ASIGNADO');
  });
});

describe('evaluateOperationalFieldTransition', () => {
  it('primera asignación produce ASIGNADO y aumenta la versión', () => {
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
