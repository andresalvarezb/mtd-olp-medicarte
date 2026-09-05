import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseBulkFile, BulkFileError } from './bulk-parser';

const requiredColumns = ['NUMERO_AUTORIZACION', 'CODIGO_PRODUCTO', 'LUGAR_DISPENSACION'];
const xlsx = (rows: unknown[][]): Buffer => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Datos');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};
const file = (rows: unknown[][]) => xlsx(rows);
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('parseBulkFile', () => {
  it('acepta columnas exactas en cualquier orden', () => {
    const parsed = parseBulkFile(file([
      ['codigo_producto', 'numero_autorizacion', 'lugar_dispensacion'], ['MED', 'A1', 'Calle 1'],
    ]), 'bulk.xlsx', mime, requiredColumns);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rawData['NUMERO_AUTORIZACION']).toBe('A1');
  });

  it('rechaza columnas adicionales con INVALID_HEADERS', () => {
    expect(() => parseBulkFile(file([
      ['numero_autorizacion', 'codigo_producto', 'lugar_dispensacion', 'extra'], ['A', 'M', 'C', 'X'],
    ]), 'bulk.xlsx', mime, requiredColumns)).toThrow(BulkFileError);
    try {
      parseBulkFile(file([
        ['numero_autorizacion', 'codigo_producto', 'lugar_dispensacion', 'extra'], ['A', 'M', 'C', 'X'],
      ]), 'bulk.xlsx', mime, requiredColumns);
    } catch (error) {
      expect((error as BulkFileError).code).toBe('INVALID_HEADERS');
    }
  });

  it('rechaza columnas faltantes, celdas adicionales y encabezados duplicados', () => {
    expect(() => parseBulkFile(file([
      ['numero_autorizacion', 'codigo_producto'], ['A', 'M'],
    ]), 'bulk.xlsx', mime, requiredColumns)).toThrow(BulkFileError);
    expect(() => parseBulkFile(file([
      ['numero_autorizacion', 'codigo_producto', 'lugar_dispensacion'], ['A', 'M', 'C', 'oculta'],
    ]), 'bulk.xlsx', mime, requiredColumns)).toThrow(BulkFileError);
    expect(() => parseBulkFile(file([
      ['numero_autorizacion', 'numero_autorizacion', 'lugar_dispensacion'], ['A', 'A', 'C'],
    ]), 'bulk.xlsx', mime, requiredColumns)).toThrow(/duplicados/);
  });

  it('omite filas completamente vacías', () => {
    const parsed = parseBulkFile(file([
      ['numero_autorizacion', 'codigo_producto', 'lugar_dispensacion'], ['A', 'M', 'Calle 1'], [null, null, null],
    ]), 'bulk.xlsx', mime, requiredColumns);
    expect(parsed.rows).toHaveLength(1);
  });

  it('rechaza CSV porque XLSX es el único formato aceptado', () => {
    expect(() => parseBulkFile(Buffer.from('data'), 'bulk.csv', 'text/csv', requiredColumns))
      .toThrow('Solo se admiten archivos XLSX');
  });
});
