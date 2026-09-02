import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseTariffImportFile, TariffFileError } from './tariff-import-parser';

describe('parseTariffImportFile', () => {
  it('parses CSV rows and normalizes product codes', () => {
    const content = Buffer.from(
      'Codigo Medicamento,Tarifa de la unidad,Número de Expediente del INVIMA,Consecutivo INVIMA (Presentación),Descripción Genérica del Medicamento (DCI),Descripción Comercial del Medicamento,Laboratorio del Medicamento,Tipo de Inclusion del Medicamento (PBS/NOPBS)\n abc 123 ,10,EXP-1,CON-1,Genérico,Comercial,Lab,PBS\nCOD-001,20,EXP-2,CON-2,Genérico,Comercial,Lab,NOPBS\n',
    );
    const parsed = parseTariffImportFile(content, 'anexo.csv', 'text/csv');
    expect(parsed.headers[0]).toBe('CODIGO_PRODUCTO');
    expect(parsed.rows).toEqual([
      expect.objectContaining({ rowNumber: 2, codigoProducto: 'ABC 123' }),
      expect.objectContaining({ rowNumber: 3, codigoProducto: 'COD-001' }),
    ]);
  });

  it('keeps blank product codes so the processor reports INVALID_PRODUCT_CODE', () => {
    const content = Buffer.from(
      'Codigo Medicamento,Tarifa de la unidad,Número de Expediente del INVIMA,Consecutivo INVIMA (Presentación),Descripción Genérica del Medicamento (DCI),Descripción Comercial del Medicamento,Laboratorio del Medicamento,Tipo de Inclusion del Medicamento (PBS/NOPBS)\n,10,EXP,CON,GEN,COM,LAB,PBS\nMED-1,10,EXP,CON,GEN,COM,LAB,PBS\n',
    );
    const parsed = parseTariffImportFile(content, 'anexo.csv', 'text/csv');
    const blankRow = parsed.rows.find((row) => row.rowNumber === 2);
    expect(blankRow?.codigoProducto).toBe('');
    expect(parsed.rows.some((row) => row.codigoProducto === 'MED-1')).toBe(true);
  });

  it('drops trailing blank rows', () => {
    const content = Buffer.from(
      'Codigo Medicamento,Tarifa de la unidad,Número de Expediente del INVIMA,Consecutivo INVIMA (Presentación),Descripción Genérica del Medicamento (DCI),Descripción Comercial del Medicamento,Laboratorio del Medicamento,Tipo de Inclusion del Medicamento (PBS/NOPBS)\nMED-1,10,EXP,CON,GEN,COM,LAB,PBS\n\n\n',
    );
    const parsed = parseTariffImportFile(content, 'anexo.csv', 'text/csv');
    expect(parsed.rows).toHaveLength(1);
  });

  it('parses XLSX input with the exact header contract', () => {
    const worksheet = XLSX.utils.aoa_to_sheet([
      [
        'CODIGO_PRODUCTO',
        'Tarifa de la unidad',
        'Número de Expediente del INVIMA',
        'Consecutivo INVIMA (Presentación)',
        'Descripción Genérica del Medicamento (DCI)',
        'Descripción Comercial del Medicamento',
        'Laboratorio del Medicamento',
        'Tipo de Inclusion del Medicamento (PBS/NOPBS)',
      ],
      ['MED-X', '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Hoja1');
    const content = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const parsed = parseTariffImportFile(
      content,
      'anexo.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.codigoProducto).toBe('MED-X');
  });

  it('rejects files without the Codigo Medicamento header', () => {
    const content = Buffer.from('codigo\nMED-1\n');
    expect(() => parseTariffImportFile(content, 'anexo.csv', 'text/csv')).toThrowError(
      TariffFileError,
    );
  });

  it('rejects unsupported extensions', () => {
    const content = Buffer.from('Codigo Medicamento\nMED-1\n');
    expect(() => parseTariffImportFile(content, 'anexo.txt', 'text/plain')).toThrowError(
      TariffFileError,
    );
  });

  it('rejects files without data rows', () => {
    const content = Buffer.from('Codigo Medicamento\n');
    expect(() => parseTariffImportFile(content, 'anexo.csv', 'text/csv')).toThrowError(
      TariffFileError,
    );
  });
});
