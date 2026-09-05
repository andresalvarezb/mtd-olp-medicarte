import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseTariffImportFile, TariffFileError } from './tariff-import-parser';

const headers = [
  'CODIGO_MEDICAMENTO', 'TARIFA_UNIDAD', 'NUMERO_EXPEDIENTE_INVIMA',
  'CONSECUTIVO_INVIMA_PRESENTACION', 'DESCRIPCION_GENERICA_MEDICAMENTO',
  'DESCRIPCION_COMERCIAL_MEDICAMENTO', 'LABORATORIO_MEDICAMENTO', 'TIPO_INCLUSION_MEDICAMENTO',
];
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function xlsx(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Anexo');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('parseTariffImportFile', () => {
  it('parses XLSX rows and normalizes product codes', () => {
    const parsed = parseTariffImportFile(xlsx([
      headers, [' abc 123 ', '10', 'EXP-1', 'CON-1', 'Genérico', 'Comercial', 'Lab', 'PBS'],
      ['COD-001', '20', 'EXP-2', 'CON-2', 'Genérico', 'Comercial', 'Lab', 'NOPBS'],
    ]), 'anexo.xlsx', mime);
    expect(parsed.headers[0]).toBe('CODIGO_PRODUCTO');
    expect(parsed.rows).toEqual([
      expect.objectContaining({ rowNumber: 2, codigoProducto: 'ABC 123' }),
      expect.objectContaining({ rowNumber: 3, codigoProducto: 'COD-001' }),
    ]);
  });

  it('keeps blank product codes so the processor reports INVALID_PRODUCT_CODE', () => {
    const parsed = parseTariffImportFile(xlsx([
      headers, ['', '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
      ['MED-1', '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'],
    ]), 'anexo.xlsx', mime);
    expect(parsed.rows.find((row) => row.rowNumber === 2)?.codigoProducto).toBe('');
    expect(parsed.rows.some((row) => row.codigoProducto === 'MED-1')).toBe(true);
  });

  it('drops trailing blank rows', () => {
    const parsed = parseTariffImportFile(xlsx([
      headers, ['MED-1', '10', 'EXP', 'CON', 'GEN', 'COM', 'LAB', 'PBS'], [null, null, null, null, null, null, null, null],
    ]), 'anexo.xlsx', mime);
    expect(parsed.rows).toHaveLength(1);
  });

  it('rechaza CSV porque XLSX es el único formato aceptado', () => {
    expect(() => parseTariffImportFile(Buffer.from('data'), 'anexo.csv', 'text/csv'))
      .toThrow('Solo se admiten archivos XLSX');
  });

  it('rechaza extensiones no soportadas, encabezados faltantes y archivos sin filas', () => {
    expect(() => parseTariffImportFile(Buffer.from('data'), 'anexo.txt', 'text/plain'))
      .toThrowError(TariffFileError);
    expect(() => parseTariffImportFile(xlsx([['codigo'], ['MED-1']]), 'anexo.xlsx', mime))
      .toThrowError(TariffFileError);
    expect(() => parseTariffImportFile(xlsx([headers]), 'anexo.xlsx', mime))
      .toThrowError(TariffFileError);
  });
});
