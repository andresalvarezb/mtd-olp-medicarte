import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { ESP014_SCHEDULING_TEMPLATE_VERSION } from '@authorization/contracts';
import {
  BulkImportFileError,
  buildEsp014SchedulingTemplate,
  parseEsp014SchedulingWorkbook,
} from './bulk-import-xlsx';

function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const DATA = [
  ['AUTORIZACION', 'DOCUMENTO', 'COD_COMERCIAL', 'CANTIDAD', 'PUNTO', 'FECHA_PROGRAMADA'],
  ['AUTH-1', '9001', 'COD1', 1, 'P-01', '2034-03-15'],
];
const META = [
  ['KEY', 'VALUE'],
  ['templateVersion', ESP014_SCHEDULING_TEMPLATE_VERSION],
  ['importType', 'SCHEDULING'],
];

describe('ESP-014 scheduling workbook parser', () => {
  it('reads the official template version from METADATA', () => {
    const parsed = parseEsp014SchedulingWorkbook(workbook({ Programacion: DATA, METADATA: META }));
    expect(parsed.templateVersion).toBe(ESP014_SCHEDULING_TEMPLATE_VERSION);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.values.AUTORIZACION).toBe('AUTH-1');
  });

  it('rejects an unknown template version', () => {
    expect(() =>
      parseEsp014SchedulingWorkbook(
        workbook({
          Programacion: DATA,
          METADATA: [
            ['KEY', 'VALUE'],
            ['templateVersion', 'ESP014_SCHEDULING_V9'],
            ['importType', 'SCHEDULING'],
          ],
        }),
      ),
    ).toThrow(BulkImportFileError);
    try {
      parseEsp014SchedulingWorkbook(
        workbook({
          Programacion: DATA,
          METADATA: [
            ['KEY', 'VALUE'],
            ['templateVersion', 'ESP014_SCHEDULING_V9'],
            ['importType', 'SCHEDULING'],
          ],
        }),
      );
    } catch (error) {
      expect((error as BulkImportFileError).code).toBe('UNKNOWN_TEMPLATE_VERSION');
    }
  });

  it('rejects a missing required header', () => {
    try {
      parseEsp014SchedulingWorkbook(
        workbook({
          Programacion: [
            ['AUTORIZACION', 'DOCUMENTO'],
            ['AUTH-1', '9001'],
          ],
          METADATA: META,
        }),
      );
      throw new Error('expected failure');
    } catch (error) {
      expect((error as BulkImportFileError).code).toBe('INVALID_HEADERS');
    }
  });

  it('rejects corrupt or non-xlsx bytes', () => {
    try {
      parseEsp014SchedulingWorkbook(Buffer.from('not-xlsx'));
      throw new Error('expected failure');
    } catch (error) {
      expect((error as BulkImportFileError).code).toBe('INVALID_FILE_FORMAT');
    }
  });

  it('rejects formula cells', () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(DATA);
    sheet.C2 = { t: 'n', v: 2, f: '1+1' };
    XLSX.utils.book_append_sheet(book, sheet, 'Programacion');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(META), 'METADATA');
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    try {
      parseEsp014SchedulingWorkbook(buffer);
      throw new Error('expected failure');
    } catch (error) {
      expect((error as BulkImportFileError).code).toBe('FORMULA_NOT_ALLOWED');
    }
  });

  it('rejects more than the MVP row limit', () => {
    const header = DATA[0] ?? [];
    const dataRow = ['AUTH-1', '9001', 'COD1', 1, 'P-01', '2034-03-15'];
    const rows: unknown[][] = [header, ...Array.from({ length: 5001 }, () => dataRow)];
    try {
      parseEsp014SchedulingWorkbook(workbook({ Programacion: rows, METADATA: META }));
      throw new Error('expected failure');
    } catch (error) {
      expect((error as BulkImportFileError).code).toBe('TOO_MANY_ROWS');
    }
  });

  it('emits a versioned official template', () => {
    const parsed = parseEsp014SchedulingWorkbook(buildEsp014SchedulingTemplate());
    expect(parsed.templateVersion).toBe(ESP014_SCHEDULING_TEMPLATE_VERSION);
    expect(parsed.rows).toEqual([]);
  });
});
