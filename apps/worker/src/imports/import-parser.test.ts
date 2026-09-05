import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseImportFile } from './import-parser';

function xlsx(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Datos');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('parseImportFile', () => {
  it('parses XLSX rows, keeps unknown source columns, and reports missing headers', () => {
    const content = xlsx([
      ['NUMERO_AUTORIZACION', 'COD_COMERCIAL', 'CUPS_PRINCIPAL', 'ESTADO_AUTORIZACION', 'No.PRESCRIPCION', 'OBS_AUTORIZACION'],
      ['AUTH-1', 'MED-1', 'MEDICAMENTOS POS', '5', '20260915000000000123', 'nota'],
      ['AUTH-2', 'MED-2', 'MEDICAMENTOS NO POS', '4', null, 'otra'],
    ]);
    const parsed = parseImportFile(content, 'authorizations.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(parsed.missingHeaders).toEqual([]);
    expect(parsed.rows[0]?.rawData).toMatchObject({
      NUMERO_AUTORIZACION: 'AUTH-1',
      CODIGO_COMERCIAL: 'MED-1',
      CUPS_PRINCIPAL: 'MEDICAMENTOS POS',
      ESTADO_AUTORIZACION: '5',
      NUMERO_PRESCRIPCION: '20260915000000000123',
      OBS_AUTORIZACION: 'nota',
    });
  });

  it('rejects CSV input because XLSX is the only accepted format', () => {
    expect(() => parseImportFile(Buffer.from('data'), 'authorizations.csv', 'text/csv'))
      .toThrow('Solo se admiten archivos XLSX');
  });

  it('rejects unsupported formats and duplicate headers', () => {
    expect(() => parseImportFile(Buffer.from('data'), 'authorizations.txt', 'text/plain'))
      .toThrow('Solo se admiten');
    expect(() => parseImportFile(
      xlsx([['NUMERO_AUTORIZACION', 'NUMERO_AUTORIZACION'], ['A', 'A']]),
      'authorizations.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )).toThrow('encabezados duplicados');
  });

  it('rejects an XLSX with missing required headers', () => {
    expect(() => parseImportFile(
      xlsx([['NUMERO_AUTORIZACION', 'CODIGO_COMERCIAL'], ['AUTH-1', 'MED-1']]),
      'authorizations.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )).toThrow('Faltan encabezados obligatorios');
  });
});
