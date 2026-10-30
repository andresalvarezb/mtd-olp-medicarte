import { describe, expect, it } from 'vitest';

import {
  buildRowValues,
  CANONICAL_HEADERS,
  type ModeratorFeeSheetRow,
} from './moderator-fee-sheet.service';

describe('fila de cuota moderadora enviada a Sheets', () => {
  it('incluye solo los datos previstos y deja vacíos nombre y factura', () => {
    const data: ModeratorFeeSheetRow = {
      authorizationItemId: 'authorization-id',
      authorizationNumber: 'AUT-PRUEBA-001',
      patientDocument: '123456789',
      patientDocumentType: 'CC',
      effectiveDate: '2026-10-29',
      professionalDocument: '987654321',
      expectedAmountCop: '12500',
      amountCop: '12500',
      status: 'COLLECTED',
      observation: null,
      registeredAt: '2026-10-29T15:00:00.000Z',
      registeredBy: 'user-id',
    };
    const headers = [...CANONICAL_HEADERS, 'NOMBRE_PACIENTE'];
    const values = buildRowValues(headers, data);
    const field = (header: string) => values[headers.indexOf(header)];

    expect(field('Identificacion_Afiliado')).toBe('123456789');
    expect(field('Tipo_Documento')).toBe('CC');
    expect(field('PROFESIONAL')).toBe('987654321');
    expect(field('Autorización')).toBe('AUT-PRUEBA-001.');
    expect(field('CopagoVALOR')).toBe('12500');
    expect(field('FACTURA')).toBe('');
    expect(field('NOMBRE_PACIENTE')).toBe('');
  });
});
