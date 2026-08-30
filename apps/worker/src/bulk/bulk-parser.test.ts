import { describe, expect, it } from 'vitest';
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
});
