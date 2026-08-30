import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseBulkFile, BulkFileError } from './bulk-parser';

const requiredColumns = ['numero_autorizacion', 'codigo_medicamento', 'lugar_dispensacion'];

function csv(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

describe('parseBulkFile', () => {
  it('acepta columnas exactas en cualquier orden', () => {
    const parsed = parseBulkFile(
      csv('codigo_medicamento,numero_autorizacion,lugar_dispensacion\nMED,A1,Calle 1\n'),
      'bulk.csv',
      'text/csv',
      requiredColumns,
    );
    const firstRow = parsed.rows[0];
    expect(parsed.rows).toHaveLength(1);
    expect(firstRow?.rawData['numero_autorizacion']).toBe('A1');
  });

  it('rechaza columnas adicionales con INVALID_HEADERS', () => {
    expect(() =>
      parseBulkFile(
        csv('numero_autorizacion,codigo_medicamento,lugar_dispensacion,extra\nA,M,C,X\n'),
        'bulk.csv',
        'text/csv',
        requiredColumns,
      ),
    ).toThrow(BulkFileError);
    try {
      parseBulkFile(
        csv('numero_autorizacion,codigo_medicamento,lugar_dispensacion,extra\nA,M,C,X\n'),
        'bulk.csv',
        'text/csv',
        requiredColumns,
      );
    } catch (error) {
      expect((error as BulkFileError).code).toBe('INVALID_HEADERS');
    }
  });

  it('rechaza columnas faltantes con INVALID_HEADERS', () => {
    expect(() =>
      parseBulkFile(
        csv('numero_autorizacion,codigo_medicamento\nA,M\n'),
        'bulk.csv',
        'text/csv',
        requiredColumns,
      ),
    ).toThrow(BulkFileError);
  });

  it('rechaza celdas adicionales aunque no tengan encabezado', () => {
    expect(() =>
      parseBulkFile(
        csv('numero_autorizacion,codigo_medicamento,lugar_dispensacion\nA,M,C,oculta\n'),
        'bulk.csv',
        'text/csv',
        requiredColumns,
      ),
    ).toThrow(BulkFileError);
  });

  it('rechaza encabezados duplicados', () => {
    expect(() =>
      parseBulkFile(
        csv('numero_autorizacion,numero_autorizacion,lugar_dispensacion\nA,A,C\n'),
        'bulk.csv',
        'text/csv',
        requiredColumns,
      ),
    ).toThrow(/duplicados/);
  });

  it('omite filas completamente vacías', () => {
    const parsed = parseBulkFile(
      csv('numero_autorizacion,codigo_medicamento,lugar_dispensacion\nA,M,Calle 1\n,,\n'),
      'bulk.csv',
      'text/csv',
      requiredColumns,
    );
    expect(parsed.rows).toHaveLength(1);
  });

  it('normaliza una fecha calendario nativa de XLSX sin convertirla en timestamp', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['numero_autorizacion', 'codigo_medicamento', 'fecha_dispensacion'],
      ['A', 'M', new Date(2026, 7, 30)],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'actualizacion');
    const content = Buffer.from(
      XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer,
    );
    const parsed = parseBulkFile(
      content,
      'bulk.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ['numero_autorizacion', 'codigo_medicamento', 'fecha_dispensacion'],
    );
    expect(parsed.rows[0]?.rawData['fecha_dispensacion']).toBe('2026-08-30');
  });
});
