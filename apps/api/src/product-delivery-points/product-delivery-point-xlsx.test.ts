import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  parseProductDeliveryPointWorkbook,
  ProductDeliveryPointFileError,
} from './product-delivery-point-xlsx';

function workbook(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Hoja1');

  return XLSX.write(book, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
}

describe('product delivery point XLSX', () => {
  it('parses the real business headers and normalizes CUM identity', () => {
    const parsed = parseProductDeliveryPointWorkbook(
      workbook([
        ['Código CUM Final ', 'MODELO', 'SEDE ENTREGA'],
        ['20039088-03-0S01LA05', 'DISPENSACION - ES ENTREGA A IPS TERCERA', 'CENTUM '],
        ['20112358-03', 'APLICACIÓN / DISPENSACION', 'CHAPINERO '],
      ]),
    );

    expect(parsed.duplicateRows).toBe(0);

    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        cumCode: '20039088-03-0S01LA05',
        invimaRecord: '20039088',
        invimaPresentation: '3',
        serviceModel: 'DISPENSACION - ES ENTREGA A IPS TERCERA',
        siteName: 'CENTUM',
        siteCode: 'CENTUM',
      },
      {
        rowNumber: 3,
        cumCode: '20112358-03',
        invimaRecord: '20112358',
        invimaPresentation: '3',
        serviceModel: 'APLICACIÓN / DISPENSACION',
        siteName: 'CHAPINERO',
        siteCode: 'CHAPINERO',
      },
    ]);
  });

  it('deduplicates the same presentation assigned to the same site', () => {
    const parsed = parseProductDeliveryPointWorkbook(
      workbook([
        ['Código CUM Final ', 'MODELO', 'SEDE ENTREGA'],
        ['20039088-03-0S01LA05', 'DISPENSACION', 'CENTUM'],
        ['20039088-03-0S01LA05', 'DISPENSACION', 'CENTUM'],
      ]),
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.duplicateRows).toBe(1);
  });

  it('rejects one presentation assigned to multiple sites', () => {
    expect(() =>
      parseProductDeliveryPointWorkbook(
        workbook([
          ['Código CUM Final ', 'MODELO', 'SEDE ENTREGA'],
          ['20039088-03-0S01LA05', 'DISPENSACION', 'CENTUM'],
          ['20039088-03-0S01LA05', 'DISPENSACION', 'CHAPINERO'],
        ]),
      ),
    ).toThrowError(ProductDeliveryPointFileError);

    try {
      parseProductDeliveryPointWorkbook(
        workbook([
          ['Código CUM Final ', 'SEDE ENTREGA'],
          ['20039088-03-0S01LA05', 'CENTUM'],
          ['20039088-03-0S01LA05', 'CHAPINERO'],
        ]),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ProductDeliveryPointFileError);

      expect((error as ProductDeliveryPointFileError).code).toBe('DELIVERY_POINT_IMPORT_CONFLICT');
    }
  });

  it('rejects malformed CUM values', () => {
    expect(() =>
      parseProductDeliveryPointWorkbook(
        workbook([
          ['Código CUM Final ', 'SEDE ENTREGA'],
          ['INVALIDO', 'CENTUM'],
        ]),
      ),
    ).toThrowError(ProductDeliveryPointFileError);
  });
});
