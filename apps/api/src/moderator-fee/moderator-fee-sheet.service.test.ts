import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildRowValues,
  CANONICAL_HEADERS,
  type ModeratorFeeSheetRow,
} from './moderator-fee-sheet.service';

const baseRow: ModeratorFeeSheetRow = {
  authorizationItemId: '30000000-0000-4000-8000-000000000001',
  authorizationNumber: 'TEST-AUTH-001',
  patientDocument: '123456789',
  patientDocumentType: 'CC',
  effectiveDate: null,
  professionalDocument: '987654321',
  expectedAmountCop: '12500',
  amountCop: '12500.00',
  status: 'COLLECTED',
  observation: null,
  registeredAt: '2026-10-16T15:00:00.000Z',
  registeredBy: '40000000-0000-4000-8000-000000000001',
};

function valueFor(header: string, row: ModeratorFeeSheetRow): string {
  const values = buildRowValues(CANONICAL_HEADERS, row);
  return values[CANONICAL_HEADERS.indexOf(header)]!;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('fila de cuota moderadora enviada a Sheets', () => {
  it('incluye los datos previstos y deja vacíos nombre y factura', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T15:00:00.000Z'));

    const headers = [...CANONICAL_HEADERS, 'NOMBRE_PACIENTE'];
    const values = buildRowValues(headers, {
      ...baseRow,
      authorizationNumber: 'AUT-PRUEBA-001',
      effectiveDate: '2026-10-29',
    });
    const field = (header: string) => values[headers.indexOf(header)];

    expect(field('Identificacion_Afiliado')).toBe('123456789');
    expect(field('Tipo_Documento')).toBe('CC');
    expect(field('PROFESIONAL')).toBe('987654321');
    expect(field('Autorización')).toBe('AUT-PRUEBA-001.');
    expect(field('CopagoVALOR')).toBe('12500.00');
    expect(field('FACTURA')).toBe('');
    expect(field('NOMBRE_PACIENTE')).toBe('');
    expect(field('AUTORIZACION DESDE')).toBe('2026-10-29');
  });
});

describe('formato de fecha efectiva para la hoja de cuota moderadora', () => {
  it('prioriza la fecha efectiva confirmada sobre la fecha de formato', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T15:00:00.000Z'));

    expect(valueFor('AUTORIZACION DESDE', {
      ...baseRow,
      effectiveDate: '2026-10-15',
    })).toBe('2026-10-15');
  });

  it('usa hoy en Bogotá solo como fallback de formato cuando no hay evidencia', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T15:00:00.000Z'));

    expect(valueFor('AUTORIZACION DESDE', baseRow)).toBe('2026-10-30');
    expect(valueFor('AUTORIZACION HASTA', baseRow)).toBe('2026-10-30');
    expect(baseRow.effectiveDate).toBeNull();
  });
});
