import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  PatientScheduleFileError,
  buildPatientScheduleTemplateXlsx,
  normalizeImportDate,
  normalizeImportQuantity,
  parsePatientScheduleFile,
} from './patient-schedule-xlsx';

function xlsxBuffer(rows: unknown[][], sheetName = 'Programacion'): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const HEADERS = [
  'AUTORIZACION',
  'DOCUMENTO',
  'COD_COMERCIAL',
  'CANTIDAD',
  'PUNTO',
  'FECHA_PROGRAMADA',
];

describe('parsePatientScheduleFile', () => {
  it('parses required columns and accepts header aliases', () => {
    const rows = parsePatientScheduleFile(
      xlsxBuffer([
        ['NUMERO_AUTORIZACION', 'NUM_DOCUMENTO', 'CODIGO_COMERCIAL', 'CANTIDAD', 'LUGAR_DISPENSACION', 'FECHA'],
        ['AUTH-1', '9001', 'cod001', 3, 'P-01', '2031-03-05'],
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.values.AUTORIZACION).toBe('AUTH-1');
    expect(rows[0]!.values.DOCUMENTO).toBe('9001');
    expect(rows[0]!.values.COD_COMERCIAL).toBe('cod001');
    expect(rows[0]!.values.CANTIDAD).toBe(3);
    expect(rows[0]!.values.FECHA_PROGRAMADA).toBe('2031-03-05');
  });

  it('preserves unknown columns as evidence', () => {
    const rows = parsePatientScheduleFile(
      xlsxBuffer([[`${HEADERS[0]}`, ...HEADERS.slice(1), 'COMENTARIO'], ['AUTH-1', '9001', 'COD1', 1, 'P-01', '2031-03-05', 'nota']]),
    );
    expect(rows[0]!.rawData.COMENTARIO).toBe('nota');
  });

  it('rejects files with missing required headers', () => {
    const attempt = (): unknown =>
      parsePatientScheduleFile(xlsxBuffer([['AUTORIZACION', 'DOCUMENTO']]));
    expect(attempt).toThrow(PatientScheduleFileError);
    try {
      attempt();
    } catch (error) {
      expect((error as PatientScheduleFileError).code).toBe('INVALID_HEADERS');
    }
  });

  it('returns no rows for a header-only file (the service rejects it)', () => {
    expect(parsePatientScheduleFile(xlsxBuffer([HEADERS]))).toEqual([]);
  });

  it('rejects non-XLSX content', () => {
    try {
      parsePatientScheduleFile(Buffer.from('autorizacion,documento\nA,1'));
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PatientScheduleFileError);
      expect((error as PatientScheduleFileError).code).toBe('INVALID_FILE_FORMAT');
    }
  });
});

describe('value normalization', () => {
  it('normalizes Excel serial dates', () => {
    // 2031-03-05 es el serial 47912 en el calendario de Excel.
    expect(normalizeImportDate(47912)).toBe('2031-03-05');
    expect(normalizeImportDate('05/03/2031')).toBe('2031-03-05');
    expect(normalizeImportDate('20310305')).toBe('2031-03-05');
    expect(normalizeImportDate('mañana')).toBeNull();
  });

  it('normalizes quantities and rejects non-integers', () => {
    expect(normalizeImportQuantity(' 4 ')).toBe(4);
    expect(normalizeImportQuantity(2.5)).toBeNull();
    expect(normalizeImportQuantity('cero')).toBeNull();
  });
});

describe('buildPatientScheduleTemplateXlsx', () => {
  it('contains the required headers in the first sheet', () => {
    const parsed = parsePatientScheduleFile(
      xlsxBuffer([
        [HEADERS[0], HEADERS[1], HEADERS[2], HEADERS[3], HEADERS[4], HEADERS[5]],
        ['AUTH-1', '9001', 'COD1', 1, 'P-01', '2031-03-05'],
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(buildPatientScheduleTemplateXlsx().length).toBeGreaterThan(0);
  });
});
