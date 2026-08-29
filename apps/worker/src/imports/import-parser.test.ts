import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseImportFile } from './import-parser';

const header = 'NUMERO_AUTORIZACION,COD_COMERCIAL,CUPS_PRINCIPAL,ESTADO_AUTORIZACION,OBS_AUTORIZACION';

describe('parseImportFile', () => {
  it('parses CSV rows, keeps unknown source columns, and reports missing headers', () => {
    const content = Buffer.from(`\uFEFF${header}\nAUTH-1,MED-1,MEDICAMENTOS POS,5,nota\nAUTH-2,MED-2,MEDICAMENTOS NO POS,4,otra\n`);
    const parsed = parseImportFile(content, 'authorizations.csv', 'text/csv');
    expect(parsed.missingHeaders).toEqual([]);
    expect(parsed.rows).toEqual([
      { rowNumber: 2, rawData: { NUMERO_AUTORIZACION: 'AUTH-1', COD_COMERCIAL: 'MED-1', CUPS_PRINCIPAL: 'MEDICAMENTOS POS', ESTADO_AUTORIZACION: '5', OBS_AUTORIZACION: 'nota' } },
      { rowNumber: 3, rawData: { NUMERO_AUTORIZACION: 'AUTH-2', COD_COMERCIAL: 'MED-2', CUPS_PRINCIPAL: 'MEDICAMENTOS NO POS', ESTADO_AUTORIZACION: '4', OBS_AUTORIZACION: 'otra' } },
    ]);
  });

  it('parses XLSX input without depending on a local shared path', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['NUMERO_AUTORIZACION', 'COD_COMERCIAL', 'CUPS_PRINCIPAL', 'ESTADO_AUTORIZACION'],
      ['AUTH-X', 'MED-X', 'MEDICAMENTOS POS', 5],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Hoja1');
    const content = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const parsed = parseImportFile(content, 'authorizations.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rawData).toMatchObject({ NUMERO_AUTORIZACION: 'AUTH-X', COD_COMERCIAL: 'MED-X' });
  });

  it('rejects unsupported formats and duplicate headers', () => {
    expect(() => parseImportFile(Buffer.from('data'), 'authorizations.txt', 'text/plain')).toThrow('Solo se admiten');
    expect(() => parseImportFile(Buffer.from('NUMERO_AUTORIZACION,NUMERO_AUTORIZACION\nA,A'), 'authorizations.csv', 'text/csv')).toThrow('encabezados duplicados');
  });
});
