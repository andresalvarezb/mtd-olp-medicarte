import { describe, expect, it } from 'vitest';
import { requiredTariffImportColumns } from '@authorization/contracts';
import { parseTariffImportFile, TariffFileError } from './tariff-import-parser';

const HEADER_ROW = requiredTariffImportColumns.join(',');
const CODE_COLUMN = 'Código Interno Medicamento';

function csv(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

function row(code: string, description = 'MEDICAMENTO DE PRUEBA'): string {
  return [
    code,
    '"1.000,00"',
    '19959808',
    '1',
    description,
    'DESCRIPCION COMERCIAL',
    'LABORATORIO',
    'PBS',
  ].join(',');
}

describe('tariff annex import parser', () => {
  it('parses the mapped commercial columns and normalizes the code', () => {
    const parsed = parseTariffImportFile(
      csv(`${HEADER_ROW}\n${row('abc 001')}\n${row('12345')}\n`),
      'anexo.csv',
      'text/csv',
      requiredTariffImportColumns,
    );
    expect(parsed.rows.map((row) => row.codigoProducto)).toEqual(['ABC 001', '12345']);
    expect(parsed.rows[0]?.rawData['Descripción Comercial del Medicamento']).toBe(
      'DESCRIPCION COMERCIAL',
    );
  });

  it('preserves textual codes with leading zeros', () => {
    const parsed = parseTariffImportFile(
      csv(`${HEADER_ROW}\n${row('00105')}\n`),
      'anexo.csv',
      'text/csv',
      requiredTariffImportColumns,
    );
    expect(parsed.rows[0]?.codigoProducto).toBe('00105');
  });

  it('marks invalid codes as null per row instead of failing the file', () => {
    const parsed = parseTariffImportFile(
      csv(`${HEADER_ROW}\n${row('X'.repeat(256))}\n${row('VALID-1')}\n`),
      'anexo.csv',
      'text/csv',
      requiredTariffImportColumns,
    );
    expect(parsed.rows[0]?.codigoProducto).toBeNull();
    expect(parsed.rows[1]?.codigoProducto).toBe('VALID-1');
  });

  it('rejects unsupported file types', () => {
    expect(() =>
      parseTariffImportFile(csv(`${HEADER_ROW}\n`), 'anexo.txt', 'text/plain', requiredTariffImportColumns),
    ).toThrow(TariffFileError);
  });

  it('rejects wrong, extra or duplicate headers', () => {
    expect(() =>
      parseTariffImportFile(csv(`${CODE_COLUMN}\n`), 'a.csv', 'text/csv', requiredTariffImportColumns),
    ).toThrow(TariffFileError);
    expect(() =>
      parseTariffImportFile(
        csv(`${HEADER_ROW},extra\n${row('X')},\n`),
        'a.csv',
        'text/csv',
        requiredTariffImportColumns,
      ),
    ).toThrow(TariffFileError);
    expect(() =>
      parseTariffImportFile(
        csv(`${HEADER_ROW},${HEADER_ROW.split(',')[0]}\n${row('X')},`),
        'a.csv',
        'text/csv',
        requiredTariffImportColumns,
      ),
    ).toThrow(TariffFileError);
  });

  it('rejects a file without data rows', () => {
    expect(() =>
      parseTariffImportFile(csv(`${HEADER_ROW}\n`), 'a.csv', 'text/csv', requiredTariffImportColumns),
    ).toThrow(TariffFileError);
  });

  it('reads numeric cells as codes without date interpretation', () => {
    const parsed = parseTariffImportFile(
      csv(`${HEADER_ROW}\n${row('00105')}\n`),
      'a.csv',
      'text/csv',
      requiredTariffImportColumns,
    );
    expect(parsed.rows[0]?.codigoProducto).toBe('00105');
  });
});
